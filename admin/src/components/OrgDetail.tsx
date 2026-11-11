import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  getOrgOverview,
  getOrgUsers,
  regenerateInsights,
  type OrgOverview,
  type OrgMember,
  type OrgSummary,
} from '../api';
import { MemberRow } from './UsersTab';
import OrgReport from './OrgReport';

type DetailTab = 'overview' | 'report' | 'members' | 'settings';

const LIVE_REFRESH_MS = 30_000;

function fmtAgoIso(iso: string | null): string {
  if (!iso) return 'never';
  return fmtAgoSeconds((Date.now() - new Date(iso).getTime()) / 1000);
}

function fmtAgoSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

function fmtDuration(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 mt-6 first:mt-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h4>
      {right}
    </div>
  );
}

// Single series (boardings per day): no legend — the title names it. Thin
// bars with rounded tops anchored to the baseline, a 2px gap between bars,
// and a per-bar hover readout. Labels use gray text, never the bar color.
function UsageChart({ days }: { days: OrgOverview['usage'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.boardings));
  const fmtDay = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const shown = hover !== null ? days[hover] : null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Boardings per day · last 30 days</p>
        <p className="text-xs text-gray-500 tabular-nums h-4">
          {shown
            ? `${fmtDay(shown.date)} · ${shown.boardings} boarded · ${shown.requests} requests`
            : `Peak ${max} on a day`}
        </p>
      </div>
      <div className="flex items-end h-28 gap-[2px] border-b border-gray-200" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <div
            key={d.date}
            className="flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setHover(i)}
            role="img"
            aria-label={`${fmtDay(d.date)}: ${d.boardings} boardings, ${d.requests} requests`}
          >
            <div
              className={`w-full rounded-t ${hover === i ? 'bg-indigo-700' : 'bg-indigo-500'}`}
              style={{ height: d.boardings > 0 ? `${Math.max(3, (d.boardings / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-gray-400">
        <span>{fmtDay(days[0]?.date ?? '')}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Overview({ org }: { org: OrgSummary }) {
  const [data, setData] = useState<OrgOverview | null>(null);
  const [error, setError] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenMsg, setRegenMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await getOrgOverview(org.orgId));
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load overview');
    }
  }, [org.orgId]);

  // Live status refreshes while the panel is open.
  useEffect(() => {
    load();
    const t = setInterval(load, LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const regenerate = async () => {
    setRegenBusy(true);
    setRegenMsg('');
    try {
      const r = await regenerateInsights(org.orgId);
      setRegenMsg(r.weekly || r.monthly ? 'Insights regenerated.' : 'No activity to summarize yet.');
      await load();
    } catch (e: any) {
      setRegenMsg(e?.message ?? 'Failed to regenerate');
    } finally {
      setRegenBusy(false);
    }
  };

  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const total30 = data.usage.reduce(
    (acc, d) => ({ boardings: acc.boardings + d.boardings, requests: acc.requests + d.requests, completed: acc.completed + d.completed }),
    { boardings: 0, requests: 0, completed: 0 },
  );
  const completion = total30.requests > 0 ? Math.round((total30.completed / total30.requests) * 100) : null;

  return (
    <div>
      {data.flags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {data.flags.map((f) => (
            <span
              key={f.text}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                f.level === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              <span aria-hidden>{f.level === 'error' ? '●' : '▲'}</span>
              {f.text}
            </span>
          ))}
        </div>
      )}

      <SectionTitle right={<span className="text-xs text-gray-400">Updates every 30s</span>}>Live now</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Buses online" value={data.live.buses.length} sub={data.live.buses.length === 0 ? `Last seen ${fmtAgoIso(data.live.lastBusSeenAt)}` : undefined} />
        <Stat label="Riders waiting" value={data.live.openRequests} />
        <Stat label="Boarded today" value={data.live.boardingsToday} sub="UTC day" />
        <Stat label="Requests today" value={data.live.requestsToday} sub="UTC day" />
      </div>

      {data.live.buses.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500">
                <th className="px-4 py-2 font-semibold">Driver</th>
                <th className="px-4 py-2 font-semibold">Route</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold hidden md:table-cell">Seats</th>
                <th className="px-4 py-2 font-semibold">Last update</th>
              </tr>
            </thead>
            <tbody>
              {data.live.buses.map((b, i) => (
                <tr key={`${b.driverName}-${i}`} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{b.driverName}</td>
                  <td className="px-4 py-2.5 text-gray-700">{b.routeName ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {b.onBreak ? (
                      <span className="text-amber-700 font-medium">On break</span>
                    ) : (
                      <span className="text-green-700 font-medium">
                        Driving{fmtDuration(b.sessionStartedAt) ? ` · ${fmtDuration(b.sessionStartedAt)}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 capitalize hidden md:table-cell">{b.occupancy ?? '—'}</td>
                  <td className={`px-4 py-2.5 tabular-nums ${b.secondsAgo >= 90 ? 'text-amber-700' : 'text-gray-500'}`}>
                    {fmtAgoSeconds(b.secondsAgo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Last 30 days</SectionTitle>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Stat label="Boarded" value={total30.boardings} />
        <Stat label="Requests" value={total30.requests} />
        <Stat label="Requests completed" value={completion === null ? '—' : `${completion}%`} />
      </div>
      <UsageChart days={data.usage} />

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <SectionTitle>Members</SectionTitle>
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm">
            <div className="grid grid-cols-2 gap-y-2">
              <span className="text-gray-500">Students</span><span className="text-right font-semibold tabular-nums">{data.members.student}</span>
              <span className="text-gray-500">Drivers</span><span className="text-right font-semibold tabular-nums">{data.members.driver}</span>
              <span className="text-gray-500">Admins</span><span className="text-right font-semibold tabular-nums">{data.members.admin}</span>
              {data.members.parent > 0 && (
                <><span className="text-gray-500">Parents</span><span className="text-right font-semibold tabular-nums">{data.members.parent}</span></>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
              An admin was last active {fmtAgoIso(data.adminLastActiveAt)}
            </p>
          </div>
        </div>
        <div>
          <SectionTitle>AI insights</SectionTitle>
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm">
            <div className="grid grid-cols-2 gap-y-2">
              <span className="text-gray-500">Weekly</span>
              <span className="text-right">{data.insights.weekly ? fmtAgoIso(data.insights.weekly.generatedAt) : 'never'}</span>
              <span className="text-gray-500">Monthly</span>
              <span className="text-right">{data.insights.monthly ? fmtAgoIso(data.insights.monthly.generatedAt) : 'never'}</span>
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={regenerate}
                disabled={regenBusy}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
              >
                {regenBusy ? 'Generating…' : 'Regenerate now'}
              </button>
              {regenMsg && <span className="text-xs text-gray-500">{regenMsg}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Members({ org }: { org: OrgSummary }) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'staff' | 'riders'>('staff');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMembers(await getOrgUsers(org.orgId));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [org.orgId]);

  useEffect(() => { load(); }, [load]);

  const staff = members.filter((m) => m.role === 'driver' || m.role === 'admin');
  const riders = members.filter((m) => m.role === 'student' || m.role === 'parent');
  const shown = filter === 'staff' ? staff : riders;

  return (
    <div>
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-3">
        {([['staff', `Staff ${staff.length}`], ['riders', `Riders ${riders.length}`]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md ${filter === k ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400">No {filter === 'staff' ? 'drivers or admins' : 'riders'} yet.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((m) => (
                <MemberRow key={m.uid} orgId={org.orgId} member={m} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Drill-in panel for one org: Overview (live status, usage, health), Report (date range), Members, Settings. */
export default function OrgDetail({ org, settings }: { org: OrgSummary; settings: ReactNode }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  return (
    <div className="bg-gray-50 border-t border-gray-100 px-5 py-4">
      <nav className="flex gap-1 border-b border-gray-200 mb-4">
        {([
          ['overview', 'Overview'],
          ['report', 'Report'],
          ['members', 'Members'],
          ['settings', 'Settings'],
        ] as [DetailTab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === k ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview org={org} />}
      {tab === 'report' && <OrgReport org={org} />}
      {tab === 'members' && <Members org={org} />}
      {tab === 'settings' && settings}
    </div>
  );
}
