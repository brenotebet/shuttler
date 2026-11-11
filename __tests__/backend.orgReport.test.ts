// __tests__/backend.orgReport.test.ts
// Tests for the super-admin date-range org report
// (GET /super-admin/orgs/:orgId/report).

import {
  buildOrgReport,
  localDate,
  parseReportRange,
  requestOutcome,
  startOfLocalDayMs,
  type ReportRequest,
} from '../backend/orgReport';

const TZ = 'America/Chicago';
const at = (iso: string) => new Date(iso).getTime();

describe('startOfLocalDayMs', () => {
  it('returns local midnight in the zone', () => {
    expect(new Date(startOfLocalDayMs('2026-11-10', TZ)).toISOString()).toBe('2026-11-10T06:00:00.000Z'); // CST
    expect(new Date(startOfLocalDayMs('2026-07-10', TZ)).toISOString()).toBe('2026-07-10T05:00:00.000Z'); // CDT
  });
  it('handles DST change days', () => {
    expect(new Date(startOfLocalDayMs('2026-03-08', TZ)).toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(new Date(startOfLocalDayMs('2026-11-01', TZ)).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });
});

describe('parseReportRange', () => {
  it('covers whole local days, end exclusive', () => {
    const r = parseReportRange('2026-11-09', '2026-11-10', TZ);
    if (!r.ok) throw new Error(r.error);
    expect(r.days).toEqual(['2026-11-09', '2026-11-10']);
    expect(new Date(r.startMs).toISOString()).toBe('2026-11-09T06:00:00.000Z');
    expect(new Date(r.endMs).toISOString()).toBe('2026-11-11T06:00:00.000Z');
  });
  it('rejects bad input', () => {
    expect(parseReportRange('2026-11-10', '2026-11-09', TZ).ok).toBe(false);
    expect(parseReportRange('11/09/2026', '2026-11-10', TZ).ok).toBe(false);
    expect(parseReportRange('2026-11-09', '2026-11-10', 'Not/AZone').ok).toBe(false);
    expect(parseReportRange('2024-01-01', '2026-01-01', TZ).ok).toBe(false);
  });
  it('defaults to UTC', () => {
    const r = parseReportRange('2026-11-10', '2026-11-10', undefined);
    expect(r.ok && r.tz).toBe('UTC');
  });
});

describe('requestOutcome', () => {
  it('buckets statuses', () => {
    expect(requestOutcome('completed', null)).toBe('completed');
    expect(requestOutcome('awaiting_confirmation', null)).toBe('completed');
    expect(requestOutcome('cancelled', 'ttl_expired_15m')).toBe('expired');
    expect(requestOutcome('cancelled', 'driver_skipped')).toBe('driverSkipped');
    expect(requestOutcome('cancelled', null)).toBe('riderCancelled');
    expect(requestOutcome('pending', null)).toBe('open');
  });
});

describe('buildOrgReport', () => {
  const req = (over: Partial<ReportRequest>): ReportRequest => ({
    createdAtMs: at('2026-11-10T14:00:00Z'), // 8am CST
    arrivedAtMs: null,
    completedAtMs: null,
    status: 'completed',
    cancelledReason: null,
    stopName: 'Library',
    driverUid: 'd1',
    riderUid: 'r1',
    ...over,
  });

  const report = buildOrgReport({
    range: { from: '2026-11-09', to: '2026-11-10', tz: TZ, days: ['2026-11-09', '2026-11-10'] },
    requests: [
      req({ arrivedAtMs: at('2026-11-10T14:04:00Z') }),
      req({ riderUid: 'r2', completedAtMs: at('2026-11-10T14:10:00Z') }),
      req({ status: 'cancelled', cancelledReason: 'ttl_expired_15m', stopName: 'Gym', driverUid: null }),
      req({ status: 'pending', driverUid: null, createdAtMs: at('2026-11-10T03:00:00Z') }), // 9pm on the 9th, local
    ],
    boardings: [{ createdAtMs: at('2026-11-10T14:05:00Z'), count: 3, stopName: 'Library', driverUid: 'd1' }],
    feedback: [
      { createdAtMs: at('2026-11-10T15:00:00Z'), question: 'How was it?', rating: 4, answer: ' Great ' },
      { createdAtMs: at('2026-11-10T16:00:00Z'), question: 'How was it?', rating: 5, answer: null },
    ],
    driverNames: new Map([['d1', 'Pat']]),
    truncated: false,
  });

  it('totals outcomes, riders and completion of finished requests', () => {
    expect(report.totals).toMatchObject({
      requests: 4, completed: 2, expired: 1, open: 1, boardings: 3, uniqueRiders: 2, activeDrivers: 1, completionRate: 67,
    });
  });
  it('measures wait from request to arrival', () => {
    expect(report.wait).toEqual({ medianMinutes: 7, avgMinutes: 7, sampled: 2 });
  });
  it('buckets by local day and hour', () => {
    expect(report.daily).toEqual([
      { date: '2026-11-09', requests: 1, completed: 0, boardings: 0 },
      { date: '2026-11-10', requests: 3, completed: 2, boardings: 3 },
    ]);
    expect(report.byHour[8]).toEqual({ hour: 8, requests: 3, boardings: 3 });
    expect(report.byHour[21].requests).toBe(1);
  });
  it('ranks stops and names drivers', () => {
    expect(report.topStops[0]).toEqual({ stopName: 'Library', requests: 3, boardings: 3, completed: 2 });
    expect(report.drivers).toEqual([{ driverName: 'Pat', completed: 2, boardings: 3 }]);
  });
  it('summarizes feedback', () => {
    expect(report.feedback).toEqual({
      responses: 2,
      avgRating: 4.5,
      comments: [{ question: 'How was it?', answer: 'Great', date: '2026-11-10' }],
    });
  });
  it('localDate uses the zone', () => {
    expect(localDate(at('2026-11-10T03:00:00Z'), TZ)).toBe('2026-11-09');
  });
});
