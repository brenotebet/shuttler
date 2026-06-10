// src/utils/analyticsMetrics.ts
// Pure aggregation helpers for the Data Analytics add-on (AdminAnalyticsScreen).
// Kept free of Firestore types so they can be unit-tested directly.

export interface RequestRecord {
  status: string;
  createdAtMs: number | null;
  arrivedAtMs: number | null;
  stopName: string;
  cancelledReason?: string | null;
}

export interface ServicePerformance {
  totalRequests: number;
  completed: number;
  cancelled: number;
  /** completed / (completed + cancelled); null until at least one request resolves */
  fulfillmentPct: number | null;
  /** average request→arrival time in minutes; null when no request has an arrival */
  avgWaitMin: number | null;
  /** slowest stops first, value = avg wait in whole minutes */
  waitByStop: { label: string; value: number }[];
  cancelReasons: { label: string; value: number }[];
}

// Waits longer than this are treated as data noise (stale docs, clock issues)
// and excluded from averages.
const WAIT_OUTLIER_MS = 120 * 60_000;

export const CANCEL_REASON_LABELS: Record<string, string> = {
  driver_offline: 'Driver went offline',
  no_buses_online: 'No buses online',
  driver_on_break: 'Driver on break',
  ttl_expired_15m: 'Timed out (15 min)',
  driver_skipped: 'Stop skipped by driver',
};

export function cancelReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Cancelled by rider';
  return CANCEL_REASON_LABELS[reason] ?? 'Cancelled by rider';
}

export function computeServicePerformance(records: RequestRecord[]): ServicePerformance {
  let completed = 0;
  let cancelled = 0;
  const waits: number[] = [];
  const stopWaits = new Map<string, { total: number; n: number }>();
  const reasons = new Map<string, number>();

  records.forEach((r) => {
    if (r.status === 'completed') completed += 1;
    if (r.status === 'cancelled') {
      cancelled += 1;
      const label = cancelReasonLabel(r.cancelledReason);
      reasons.set(label, (reasons.get(label) ?? 0) + 1);
    }

    if (r.createdAtMs !== null && r.arrivedAtMs !== null) {
      const wait = r.arrivedAtMs - r.createdAtMs;
      if (wait >= 0 && wait <= WAIT_OUTLIER_MS) {
        waits.push(wait);
        const s = stopWaits.get(r.stopName) ?? { total: 0, n: 0 };
        s.total += wait;
        s.n += 1;
        stopWaits.set(r.stopName, s);
      }
    }
  });

  const resolved = completed + cancelled;
  const avgWaitMs = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;

  const waitByStop = [...stopWaits.entries()]
    .map(([label, { total, n }]) => ({ label, value: Math.round(total / n / 60_000) }))
    .sort((a, b) => b.value - a.value);

  const cancelReasons = [...reasons.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return {
    totalRequests: records.length,
    completed,
    cancelled,
    fulfillmentPct: resolved > 0 ? Math.round((completed / resolved) * 100) : null,
    avgWaitMin: avgWaitMs !== null ? Math.round((avgWaitMs / 60_000) * 10) / 10 : null,
    waitByStop,
    cancelReasons,
  };
}

export function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** Buckets boardings by local hour of day; returns the busiest hours first. */
export function busiestHours(
  records: { createdAtMs: number | null; count: number }[],
  maxItems = 6,
): { label: string; value: number }[] {
  const hours = new Array(24).fill(0) as number[];
  records.forEach((r) => {
    if (!r.createdAtMs) return;
    hours[new Date(r.createdAtMs).getHours()] += r.count;
  });
  return hours
    .map((value, hour) => ({ label: formatHourLabel(hour), value }))
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, maxItems);
}
