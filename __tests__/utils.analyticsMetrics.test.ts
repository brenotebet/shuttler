// __tests__/utils.analyticsMetrics.test.ts
// Tests for the Data Analytics add-on aggregation helpers.

import {
  busiestHours,
  cancelReasonLabel,
  computeServicePerformance,
  formatHourLabel,
  RequestRecord,
} from '../src/utils/analyticsMetrics';

const MIN = 60_000;

function req(overrides: Partial<RequestRecord>): RequestRecord {
  return {
    status: 'completed',
    createdAtMs: 1_000_000_000,
    arrivedAtMs: null,
    stopName: 'Main Gate',
    cancelledReason: null,
    ...overrides,
  };
}

describe('computeServicePerformance', () => {
  it('computes average wait from request to arrival', () => {
    const records = [
      req({ createdAtMs: 0, arrivedAtMs: 4 * MIN }),
      req({ createdAtMs: 0, arrivedAtMs: 8 * MIN }),
    ];
    expect(computeServicePerformance(records).avgWaitMin).toBe(6);
  });

  it('returns null avg wait when no request has an arrival', () => {
    const records = [req({ arrivedAtMs: null }), req({ status: 'cancelled', cancelledReason: 'driver_offline' })];
    expect(computeServicePerformance(records).avgWaitMin).toBeNull();
  });

  it('excludes negative and outlier waits from the average', () => {
    const records = [
      req({ createdAtMs: 10 * MIN, arrivedAtMs: 0 }),            // negative — clock skew
      req({ createdAtMs: 0, arrivedAtMs: 300 * MIN }),            // 5h — stale doc
      req({ createdAtMs: 0, arrivedAtMs: 10 * MIN }),             // valid
    ];
    expect(computeServicePerformance(records).avgWaitMin).toBe(10);
  });

  it('computes fulfillment from resolved requests only', () => {
    const records = [
      req({ status: 'completed' }),
      req({ status: 'completed' }),
      req({ status: 'cancelled', cancelledReason: 'ttl_expired_15m' }),
      req({ status: 'pending' }), // still active — not in the denominator
    ];
    const perf = computeServicePerformance(records);
    expect(perf.fulfillmentPct).toBe(67);
    expect(perf.totalRequests).toBe(4);
    expect(perf.completed).toBe(2);
    expect(perf.cancelled).toBe(1);
  });

  it('returns null fulfillment when nothing has resolved yet', () => {
    expect(computeServicePerformance([req({ status: 'pending' })]).fulfillmentPct).toBeNull();
  });

  it('ranks stops by average wait, slowest first', () => {
    const records = [
      req({ stopName: 'Library', createdAtMs: 0, arrivedAtMs: 12 * MIN }),
      req({ stopName: 'Main Gate', createdAtMs: 0, arrivedAtMs: 3 * MIN }),
      req({ stopName: 'Main Gate', createdAtMs: 0, arrivedAtMs: 5 * MIN }),
    ];
    const { waitByStop } = computeServicePerformance(records);
    expect(waitByStop).toEqual([
      { label: 'Library', value: 12 },
      { label: 'Main Gate', value: 4 },
    ]);
  });

  it('groups cancellations by human-readable reason', () => {
    const records = [
      req({ status: 'cancelled', cancelledReason: 'driver_offline' }),
      req({ status: 'cancelled', cancelledReason: 'driver_offline' }),
      req({ status: 'cancelled', cancelledReason: null }),
    ];
    const { cancelReasons } = computeServicePerformance(records);
    expect(cancelReasons).toEqual([
      { label: 'Driver went offline', value: 2 },
      { label: 'Cancelled by rider', value: 1 },
    ]);
  });

  it('handles an empty list', () => {
    const perf = computeServicePerformance([]);
    expect(perf.totalRequests).toBe(0);
    expect(perf.avgWaitMin).toBeNull();
    expect(perf.fulfillmentPct).toBeNull();
    expect(perf.waitByStop).toEqual([]);
  });
});

describe('cancelReasonLabel', () => {
  it('maps known reasons', () => {
    expect(cancelReasonLabel('no_buses_online')).toBe('No buses online');
    expect(cancelReasonLabel('driver_skipped')).toBe('Stop skipped by driver');
  });

  it('defaults unknown or missing reasons to rider cancellation', () => {
    expect(cancelReasonLabel(undefined)).toBe('Cancelled by rider');
    expect(cancelReasonLabel('something_new')).toBe('Cancelled by rider');
  });
});

describe('formatHourLabel', () => {
  it('formats 12-hour labels', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(8)).toBe('8 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(17)).toBe('5 PM');
  });
});

describe('busiestHours', () => {
  // Build timestamps at fixed local hours of today.
  const atHour = (h: number) => new Date(2026, 5, 10, h, 30).getTime();

  it('buckets boardings by hour and sorts busiest first', () => {
    const records = [
      { createdAtMs: atHour(8), count: 5 },
      { createdAtMs: atHour(8), count: 3 },
      { createdAtMs: atHour(17), count: 10 },
      { createdAtMs: atHour(12), count: 1 },
    ];
    expect(busiestHours(records)).toEqual([
      { label: '5 PM', value: 10 },
      { label: '8 AM', value: 8 },
      { label: '12 PM', value: 1 },
    ]);
  });

  it('skips records without timestamps and respects maxItems', () => {
    const records = [
      { createdAtMs: null, count: 99 },
      ...[6, 7, 8, 9, 10, 11, 12].map((h, i) => ({ createdAtMs: atHour(h), count: i + 1 })),
    ];
    const result = busiestHours(records, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ label: '12 PM', value: 7 });
  });

  it('returns empty for no data', () => {
    expect(busiestHours([])).toEqual([]);
  });
});
