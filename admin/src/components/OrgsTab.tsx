import { useCallback, useEffect, useState } from 'react';
import {
  listOrgs,
  setOrgLimits,
  setDataAddon,
  extendTrial,
  type OrgSummary,
} from '../api';
import RefreshButton from './RefreshButton';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? 'none';
  const tone =
    s === 'active' ? 'bg-green-100 text-green-700'
    : s === 'trialing' ? 'bg-blue-100 text-blue-700'
    : s === 'past_due' || s === 'canceled' || s === 'unpaid' ? 'bg-red-100 text-red-700'
    : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tone}`}>
      {s}
    </span>
  );
}

function OrgActions({ org, onChanged }: { org: OrgSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [maxVehicles, setMaxVehicles] = useState(org.limitOverrides?.maxVehicles?.toString() ?? '');
  const [maxRoutes, setMaxRoutes] = useState(org.limitOverrides?.maxRoutes?.toString() ?? '');
  const [maxStops, setMaxStops] = useState(org.limitOverrides?.maxStops?.toString() ?? '');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const inputCls = 'w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';
  const btnCls = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40';

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-4 space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Data add-on comp */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Data add-on</span>
        <span className="text-sm text-gray-500">{org.dataAddonActive ? 'Active' : 'Inactive'}</span>
        <button
          disabled={busy !== null}
          onClick={() => {
            const verb = org.dataAddonActive ? 'Revoke' : 'Comp (grant for free)';
            if (window.confirm(`${verb} the Data Analytics add-on for "${org.name ?? org.orgId}"?`)) {
              run('addon', () => setDataAddon(org.orgId, !org.dataAddonActive));
            }
          }}
          className={`${btnCls} ${org.dataAddonActive ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
        >
          {busy === 'addon' ? '…' : org.dataAddonActive ? 'Revoke' : 'Comp add-on'}
        </button>
      </div>

      {/* Trial extension */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Trial</span>
        <span className="text-sm text-gray-500">
          {org.trialEndsAt ? `ends ${fmtDate(org.trialEndsAt)}` : 'no trial end set'}
        </span>
        <input
          type="number"
          min={1}
          max={90}
          value={trialDays}
          onChange={(e) => setTrialDays(e.target.value)}
          className={inputCls}
        />
        <button
          disabled={busy !== null}
          onClick={() => run('trial', () => extendTrial(org.orgId, parseInt(trialDays, 10) || 14))}
          className={`${btnCls} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
        >
          {busy === 'trial' ? '…' : 'Extend (days)'}
        </button>
      </div>

      {/* Limit overrides */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Limit overrides</span>
        <label className="text-xs text-gray-500">Vehicles
          <input type="number" min={1} value={maxVehicles} onChange={(e) => setMaxVehicles(e.target.value)} className={`${inputCls} ml-1`} placeholder="—" />
        </label>
        <label className="text-xs text-gray-500">Routes
          <input type="number" min={1} value={maxRoutes} onChange={(e) => setMaxRoutes(e.target.value)} className={`${inputCls} ml-1`} placeholder="—" />
        </label>
        <label className="text-xs text-gray-500">Stops
          <input type="number" min={1} value={maxStops} onChange={(e) => setMaxStops(e.target.value)} className={`${inputCls} ml-1`} placeholder="—" />
        </label>
        <button
          disabled={busy !== null}
          onClick={() => run('limits', () => setOrgLimits(org.orgId, {
            ...(parseInt(maxVehicles, 10) > 0 ? { maxVehicles: parseInt(maxVehicles, 10) } : {}),
            ...(parseInt(maxRoutes, 10) > 0 ? { maxRoutes: parseInt(maxRoutes, 10) } : {}),
            ...(parseInt(maxStops, 10) > 0 ? { maxStops: parseInt(maxStops, 10) } : {}),
          }))}
          className={`${btnCls} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
        >
          {busy === 'limits' ? '…' : 'Save'}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm('Clear all limit overrides? The org falls back to its plan-tier limits.')) {
              setMaxVehicles(''); setMaxRoutes(''); setMaxStops('');
              run('limits', () => setOrgLimits(org.orgId, {}));
            }
          }}
          className={`${btnCls} text-gray-500 hover:text-gray-800`}
        >
          Clear
        </button>
      </div>
      <p className="text-xs text-amber-600">
        ⚠ For orgs with an active Stripe subscription, set overrides in the Stripe subscription
        metadata too — the webhook re-stamps them on every subscription event.
      </p>
    </div>
  );
}

export default function OrgsTab() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOrgs(await listOrgs());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load orgs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Organizations</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${orgs.length} orgs · ${orgs.filter((o) => o.subscriptionStatus === 'active').length} subscribed`}
          </p>
        </div>
        <RefreshButton onClick={load} loading={loading} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}

      {!loading && orgs.length === 0 && !error && (
        <div className="text-center py-20 text-gray-400">
          <p className="font-medium">No organizations yet</p>
        </div>
      )}

      {orgs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Org</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Plan</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Add-on</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Renews / Trial ends</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Buses online</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Requests 24h</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <OrgRow
                  key={org.orgId}
                  org={org}
                  expanded={expanded === org.orgId}
                  onToggle={() => setExpanded(expanded === org.orgId ? null : org.orgId)}
                  onChanged={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OrgRow({ org, expanded, onToggle, onChanged }: {
  org: OrgSummary;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-gray-50 cursor-pointer hover:bg-indigo-50/40 transition-colors ${expanded ? 'bg-indigo-50/40' : ''}`}
      >
        <td className="px-4 py-3">
          <p className="font-medium text-gray-900">{org.name ?? '—'}</p>
          <p className="text-xs text-gray-400">
            {org.founderEmail ?? org.slug ?? org.orgId.slice(0, 8)}
            {!org.approved && <span className="ml-2 text-amber-600 font-medium">pending review</span>}
          </p>
        </td>
        <td className="px-4 py-3 text-gray-700 capitalize">{org.subscriptionPlan ?? '—'}</td>
        <td className="px-4 py-3"><StatusBadge status={org.subscriptionStatus} /></td>
        <td className="px-4 py-3 hidden md:table-cell">
          {org.dataAddonActive ? <span className="text-green-600 font-medium">✓ Data</span> : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-4 py-3 text-gray-500 hidden lg:table-cell whitespace-nowrap">
          {org.subscriptionStatus === 'trialing'
            ? (org.trialEndsAt ? `trial · ${fmtDate(org.trialEndsAt)}` : 'trial')
            : fmtDate(org.currentPeriodEnd)}
        </td>
        <td className="px-4 py-3">
          {org.busesOnline > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-green-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {org.busesOnline}
            </span>
          ) : (
            <span className="text-gray-400" title={`Last bus seen ${fmtAgo(org.lastBusSeenAt)}`}>
              0 · {fmtAgo(org.lastBusSeenAt)}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-700 hidden sm:table-cell">{org.requests24h}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <OrgActions org={org} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}
