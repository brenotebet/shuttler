import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getOrgReport, type OrgReport as Report, type OrgSummary } from '../api';

// Date-range report for one org, built for check-in meetings with its admins:
// pick a day or range, review the numbers, then print / save as PDF or copy a
// plain-text summary into an email.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}
function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
function fmtRange(from: string, to: string): string {
  const full: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return from === to ? fmtDate(from, { weekday: 'short', ...full }) : `${fmtDate(from, full)} – ${fmtDate(to, full)}`;
}
function fmtHour(h: number): string {
  const suffix = h < 12 ? 'a' : 'p';
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'Yesterday', range: () => [daysAgo(1), daysAgo(1)] },
  { label: 'Today', range: () => [daysAgo(0), daysAgo(0)] },
  { label: 'Last 7 days', range: () => [daysAgo(6), daysAgo(0)] },
  { label: 'Last 30 days', range: () => [daysAgo(29), daysAgo(0)] },
  {
    label: 'This month',
    range: () => {
      const d = new Date();
      return [isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), daysAgo(0)];
    },
  },
  {
    label: 'Last month',
    range: () => {
      const d = new Date();
      return [isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), isoDate(new Date(d.getFullYear(), d.getMonth(), 0))];
    },
  },
];

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 break-inside-avoid">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 mt-6">{children}</h4>;
}

/** Single-series bar chart with a hover readout. */
function Bars({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: { key: string; label: string; value: number; detail: string }[];
  emptyText: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  const shown = hover !== null ? items[hover] : null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 break-inside-avoid">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 tabular-nums h-4 truncate">{shown ? shown.detail : total === 0 ? emptyText : ''}</p>
      </div>
      <div className="flex items-end h-28 gap-[2px] border-b border-gray-200" onMouseLeave={() => setHover(null)}>
        {items.map((it, i) => (
          <div
            key={it.key}
            className="flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setHover(i)}
            role="img"
            aria-label={it.detail}
          >
            <div
              className={`w-full rounded-t ${hover === i ? 'bg-indigo-700' : 'bg-indigo-500'}`}
              style={{ height: it.value > 0 ? `${Math.max(3, (it.value / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-gray-400">
        <span>{items[0]?.label}</span>
        {items.length > 2 && <span>{items[Math.floor(items.length / 2)]?.label}</span>}
        <span>{items[items.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden break-inside-avoid">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-gray-50 last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className={`px-4 py-2 ${ci === 0 ? 'text-gray-900 font-medium' : 'text-right tabular-nums text-gray-700'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function summaryText(orgName: string, r: Report): string {
  const t = r.totals;
  const lines = [
    `${orgName} — Shuttler report`,
    `${fmtRange(r.range.from, r.range.to)} (${r.range.tz})`,
    '',
    `Riders boarded: ${t.boardings}`,
    `Stop requests: ${t.requests} from ${t.uniqueRiders} riders`,
    `Completed: ${t.completed} (${t.completionRate ?? '—'}% of finished requests)`,
    `Expired unanswered: ${t.expired} · Skipped by driver: ${t.driverSkipped} · Cancelled by rider: ${t.riderCancelled}`,
    r.wait.medianMinutes !== null ? `Typical wait for pickup: ${r.wait.medianMinutes} min (median), ${r.wait.avgMinutes} min average` : '',
    `Active drivers: ${t.activeDrivers}`,
  ];
  if (r.topStops.length) {
    lines.push('', 'Busiest stops:');
    r.topStops.slice(0, 5).forEach((s) => lines.push(`  • ${s.stopName}: ${s.boardings} boarded, ${s.requests} requests`));
  }
  const peak = [...r.byHour].sort((a, b) => b.requests + b.boardings - (a.requests + a.boardings))[0];
  if (peak && peak.requests + peak.boardings > 0) lines.push('', `Busiest hour: ${fmtHour(peak.hour)}–${fmtHour((peak.hour + 1) % 24)}`);
  if (r.feedback.responses) {
    lines.push('', `Rider feedback: ${r.feedback.responses} responses${r.feedback.avgRating !== null ? `, avg rating ${r.feedback.avgRating}/5` : ''}`);
  }
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

export default function OrgReport({ org }: { org: OrgSummary }) {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(daysAgo(0));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError('');
    try {
      setReport(await getOrgReport(org.orgId, f, t, TZ));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [org.orgId]);

  useEffect(() => { load(from, to); }, [load, from, to]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const [f, t] = p.range();
    setFrom(f);
    setTo(t);
  };

  const copySummary = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(summaryText(org.name ?? org.slug ?? org.orgId, report));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Print just the report: a fresh window with the app's styles and this node.
  const print = () => {
    const node = printRef.current;
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!node || !w) return;
    const styles = [...document.head.querySelectorAll('style, link[rel="stylesheet"]')].map((s) => s.outerHTML).join('');
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${org.name ?? 'Org'} report</title>${styles}` +
      `<style>body{background:#fff;padding:24px}@page{margin:14mm}</style></head><body>${node.outerHTML}</body></html>`,
    );
    w.document.close();
    // Stylesheet <link>s load async; print once they're in (or after a short fallback).
    let printed = false;
    const go = () => { if (printed || w.closed) return; printed = true; w.focus(); w.print(); };
    w.addEventListener('load', go);
    setTimeout(go, 800);
  };

  const t = report?.totals;
  const singleDay = report && report.range.from === report.range.to;

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <label className="text-xs font-medium text-gray-500">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="block mt-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="text-xs font-medium text-gray-500">
          To
          <input
            type="date"
            value={to}
            min={from}
            max={daysAgo(0)}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="block mt-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900"
          />
        </label>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={copySummary}
            disabled={!report}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-white disabled:opacity-40"
          >
            {copied ? 'Copied ✓' : 'Copy summary'}
          </button>
          <button
            onClick={print}
            disabled={!report}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Print / PDF
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="text-xs font-medium px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {!report && loading && <p className="text-sm text-gray-400">Loading…</p>}

      {report && t && (
        <div ref={printRef} className={loading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          <div className="mb-4">
            <p className="text-lg font-bold text-gray-900">{org.name ?? org.slug ?? 'Org'}</p>
            <p className="text-sm text-gray-500">{fmtRange(report.range.from, report.range.to)} · times in {report.range.tz}</p>
          </div>

          {report.truncated && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              This range has more than 10,000 records, so the numbers are partial. Pick a shorter range for exact totals.
            </p>
          )}

          {t.requests === 0 && t.boardings === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No rides or requests in this range.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Riders boarded" value={t.boardings} />
                <Stat label="Stop requests" value={t.requests} sub={`from ${t.uniqueRiders} rider${t.uniqueRiders === 1 ? '' : 's'}`} />
                <Stat label="Requests completed" value={t.completionRate === null ? '—' : `${t.completionRate}%`} sub="of finished requests" />
                <Stat
                  label="Typical wait"
                  value={report.wait.medianMinutes === null ? '—' : `${report.wait.medianMinutes}m`}
                  sub={report.wait.avgMinutes === null ? 'request → bus arrived' : `median · avg ${report.wait.avgMinutes}m`}
                />
              </div>

              <SectionTitle>What happened to requests</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Stat label="Completed" value={t.completed} sub={pct(t.completed, t.requests)} />
                <Stat label="Expired unanswered" value={t.expired} sub={pct(t.expired, t.requests)} />
                <Stat label="Skipped by driver" value={t.driverSkipped} sub={pct(t.driverSkipped, t.requests)} />
                <Stat label="Cancelled by rider" value={t.riderCancelled} sub={pct(t.riderCancelled, t.requests)} />
                <Stat label="Still open" value={t.open} />
              </div>

              <SectionTitle>When</SectionTitle>
              <div className={`grid gap-3 ${singleDay ? '' : 'md:grid-cols-2'}`}>
                {!singleDay && (
                  <Bars
                    title="Boardings per day"
                    emptyText="No boardings"
                    items={report.daily.map((d) => ({
                      key: d.date,
                      label: fmtDate(d.date),
                      value: d.boardings,
                      detail: `${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.boardings} boarded · ${d.requests} requests`,
                    }))}
                  />
                )}
                <Bars
                  title="Requests by hour of day"
                  emptyText="No requests"
                  items={report.byHour.map((h) => ({
                    key: String(h.hour),
                    label: fmtHour(h.hour),
                    value: h.requests,
                    detail: `${fmtHour(h.hour)}–${fmtHour((h.hour + 1) % 24)} · ${h.requests} requests · ${h.boardings} boarded`,
                  }))}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <SectionTitle>Busiest stops</SectionTitle>
                  {report.topStops.length === 0 ? (
                    <p className="text-sm text-gray-400">No stop activity.</p>
                  ) : (
                    <Table
                      head={['Stop', 'Boarded', 'Requests', 'Completed']}
                      rows={report.topStops.map((s) => [s.stopName, s.boardings, s.requests, pct(s.completed, s.requests)])}
                    />
                  )}
                </div>
                <div>
                  <SectionTitle>Drivers ({t.activeDrivers})</SectionTitle>
                  {report.drivers.length === 0 ? (
                    <p className="text-sm text-gray-400">No driver activity.</p>
                  ) : (
                    <Table
                      head={['Driver', 'Boarded', 'Requests done']}
                      rows={report.drivers.map((d) => [d.driverName, d.boardings, d.completed])}
                    />
                  )}
                </div>
              </div>

              {!singleDay && report.daily.length <= 62 && (
                <>
                  <SectionTitle>Day by day</SectionTitle>
                  <Table
                    head={['Day', 'Boarded', 'Requests', 'Completed']}
                    rows={report.daily.map((d) => [
                      fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' }),
                      d.boardings,
                      d.requests,
                      d.completed,
                    ])}
                  />
                </>
              )}
            </>
          )}

          <SectionTitle>Rider feedback</SectionTitle>
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm break-inside-avoid">
            {report.feedback.responses === 0 ? (
              <p className="text-gray-400">No feedback in this range.</p>
            ) : (
              <>
                <p className="text-gray-700">
                  <span className="font-semibold text-gray-900">{report.feedback.responses}</span> responses
                  {report.feedback.avgRating !== null && (
                    <> · average rating <span className="font-semibold text-gray-900">{report.feedback.avgRating}/5</span></>
                  )}
                </p>
                {report.feedback.comments.length > 0 && (
                  <ul className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    {report.feedback.comments.map((c, i) => (
                      <li key={i}>
                        <p className="text-gray-900">“{c.answer}”</p>
                        <p className="text-xs text-gray-400">{c.question} · {fmtDate(c.date)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
