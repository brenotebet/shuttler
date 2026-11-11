// backend/orgReport.ts
// Pure aggregation for GET /super-admin/orgs/:orgId/report — a date-range
// summary of one org's activity, meant for check-in meetings with its admins.
// Kept free of Firestore so it can be unit tested; the endpoint maps docs to
// the plain shapes below.

export type ReportRequest = {
  createdAtMs: number;
  arrivedAtMs: number | null;
  completedAtMs: number | null;
  status: string;
  cancelledReason: string | null;
  stopName: string;
  driverUid: string | null;
  riderUid: string | null;
};

export type ReportBoarding = {
  createdAtMs: number;
  count: number;
  stopName: string;
  driverUid: string | null;
};

export type ReportFeedback = {
  createdAtMs: number;
  question: string;
  rating: number | null;
  answer: string | null;
};

export type OrgReport = {
  range: { from: string; to: string; tz: string };
  totals: {
    requests: number;
    completed: number;
    riderCancelled: number;
    driverSkipped: number;
    expired: number;
    open: number;
    completionRate: number | null;
    boardings: number;
    uniqueRiders: number;
    activeDrivers: number;
  };
  wait: { medianMinutes: number | null; avgMinutes: number | null; sampled: number };
  daily: { date: string; requests: number; completed: number; boardings: number }[];
  byHour: { hour: number; requests: number; boardings: number }[];
  topStops: { stopName: string; requests: number; boardings: number; completed: number }[];
  drivers: { driverName: string; completed: number; boardings: number }[];
  feedback: {
    responses: number;
    avgRating: number | null;
    comments: { question: string; answer: string; date: string }[];
  };
  truncated: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_REPORT_DAYS = 366;
/** Waits longer than this are treated as bad data (e.g. a request left open overnight). */
const MAX_PLAUSIBLE_WAIT_MS = 2 * 60 * 60 * 1000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar parts of an instant as seen in `tz`. */
function partsInTz(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

/** The YYYY-MM-DD date of an instant in `tz`. */
export function localDate(ms: number, tz: string): string {
  const p = partsInTz(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** UTC millis of local midnight on `date` (YYYY-MM-DD) in `tz`, DST-safe. */
export function startOfLocalDayMs(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Offset of tz at the guess, then correct once more in case midnight
  // falls on the other side of a DST change.
  const offsetAt = (ms: number) => {
    const p = partsInTz(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return ms;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Validates the query and returns the [startMs, endMs) window plus each day in it. */
export function parseReportRange(
  from: unknown,
  to: unknown,
  tz: unknown,
): { ok: true; startMs: number; endMs: number; days: string[]; tz: string; from: string; to: string } | { ok: false; error: string } {
  if (typeof from !== 'string' || !DATE_RE.test(from)) return { ok: false, error: 'from must be YYYY-MM-DD' };
  if (typeof to !== 'string' || !DATE_RE.test(to)) return { ok: false, error: 'to must be YYYY-MM-DD' };
  const zone = typeof tz === 'string' && tz ? tz : 'UTC';
  if (!isValidTimeZone(zone)) return { ok: false, error: 'Unknown time zone' };
  if (from > to) return { ok: false, error: 'from must be on or before to' };
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_REPORT_DAYS) return { ok: false, error: `Range is limited to ${MAX_REPORT_DAYS} days` };
  }
  return {
    ok: true,
    startMs: startOfLocalDayMs(from, zone),
    endMs: startOfLocalDayMs(addDays(to, 1), zone),
    days,
    tz: zone,
    from,
    to,
  };
}

export type RequestOutcome = 'completed' | 'riderCancelled' | 'driverSkipped' | 'expired' | 'open';

export function requestOutcome(status: string, cancelledReason: string | null): RequestOutcome {
  if (status === 'completed' || status === 'awaiting_confirmation') return 'completed';
  if (status === 'cancelled') {
    if (cancelledReason === 'driver_skipped') return 'driverSkipped';
    if (cancelledReason && cancelledReason.startsWith('ttl_expired')) return 'expired';
    return 'riderCancelled';
  }
  return 'open';
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildOrgReport(input: {
  range: { from: string; to: string; tz: string; days: string[] };
  requests: ReportRequest[];
  boardings: ReportBoarding[];
  feedback: ReportFeedback[];
  driverNames: Map<string, string>;
  truncated: boolean;
}): OrgReport {
  const { range, requests, boardings, feedback, driverNames, truncated } = input;
  const tz = range.tz;

  const daily = new Map(range.days.map((date) => [date, { date, requests: 0, completed: 0, boardings: 0 }]));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, requests: 0, boardings: 0 }));
  const stops = new Map<string, { stopName: string; requests: number; boardings: number; completed: number }>();
  const drivers = new Map<string, { completed: number; boardings: number }>();
  const stopRow = (name: string) => {
    let row = stops.get(name);
    if (!row) stops.set(name, (row = { stopName: name, requests: 0, boardings: 0, completed: 0 }));
    return row;
  };
  const driverRow = (uid: string) => {
    let row = drivers.get(uid);
    if (!row) drivers.set(uid, (row = { completed: 0, boardings: 0 }));
    return row;
  };

  const outcomes: Record<RequestOutcome, number> = { completed: 0, riderCancelled: 0, driverSkipped: 0, expired: 0, open: 0 };
  const riders = new Set<string>();
  const waits: number[] = [];

  for (const r of requests) {
    const outcome = requestOutcome(r.status, r.cancelledReason);
    outcomes[outcome] += 1;
    if (r.riderUid) riders.add(r.riderUid);

    const day = daily.get(localDate(r.createdAtMs, tz));
    if (day) {
      day.requests += 1;
      if (outcome === 'completed') day.completed += 1;
    }
    byHour[partsInTz(r.createdAtMs, tz).h].requests += 1;

    const stop = stopRow(r.stopName);
    stop.requests += 1;
    if (outcome === 'completed') {
      stop.completed += 1;
      if (r.driverUid) driverRow(r.driverUid).completed += 1;
      const servedAt = r.arrivedAtMs ?? r.completedAtMs;
      if (servedAt) {
        const wait = servedAt - r.createdAtMs;
        if (wait > 0 && wait <= MAX_PLAUSIBLE_WAIT_MS) waits.push(wait);
      }
    }
  }

  let totalBoardings = 0;
  for (const b of boardings) {
    totalBoardings += b.count;
    const day = daily.get(localDate(b.createdAtMs, tz));
    if (day) day.boardings += b.count;
    byHour[partsInTz(b.createdAtMs, tz).h].boardings += b.count;
    stopRow(b.stopName).boardings += b.count;
    if (b.driverUid) driverRow(b.driverUid).boardings += b.count;
  }

  waits.sort((a, b) => a - b);
  const toMin = (ms: number) => round1(ms / 60_000);
  const med = median(waits);

  const rated = feedback.filter((f) => typeof f.rating === 'number');
  const comments = feedback
    .filter((f) => f.answer && f.answer.trim())
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 20)
    .map((f) => ({ question: f.question, answer: f.answer!.trim(), date: localDate(f.createdAtMs, tz) }));

  const decided = outcomes.completed + outcomes.riderCancelled + outcomes.driverSkipped + outcomes.expired;

  return {
    range: { from: range.from, to: range.to, tz },
    totals: {
      requests: requests.length,
      ...outcomes,
      completionRate: decided > 0 ? Math.round((outcomes.completed / decided) * 100) : null,
      boardings: totalBoardings,
      uniqueRiders: riders.size,
      activeDrivers: drivers.size,
    },
    wait: {
      medianMinutes: med === null ? null : toMin(med),
      avgMinutes: waits.length ? toMin(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      sampled: waits.length,
    },
    daily: [...daily.values()],
    byHour,
    topStops: [...stops.values()]
      .sort((a, b) => b.requests + b.boardings - (a.requests + a.boardings))
      .slice(0, 10),
    drivers: [...drivers.entries()]
      .map(([uid, row]) => ({ driverName: driverNames.get(uid) ?? 'Unknown driver', ...row }))
      .sort((a, b) => b.boardings + b.completed - (a.boardings + a.completed)),
    feedback: {
      responses: feedback.length,
      avgRating: rated.length ? round1(rated.reduce((a, f) => a + (f.rating as number), 0) / rated.length) : null,
      comments,
    },
    truncated,
  };
}
