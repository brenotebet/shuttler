import { useCallback, useEffect, useState } from 'react';
import {
  listOrgs,
  setOrgLimits,
  setDataAddon,
  extendTrial,
  updateOrgProfile,
  setSubscription,
  suspendOrg,
  reinstateOrg,
  deleteOrg,
  resetAuthMethod,
  updateAllowedDomains,
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
  const [name, setName] = useState(org.name ?? '');
  const [founderEmail, setFounderEmail] = useState(org.founderEmail ?? '');
  const [domains, setDomains] = useState((org.allowedEmailDomains ?? []).join(', '));
  const [subStatus, setSubStatus] = useState(org.subscriptionStatus ?? 'trialing');
  const [subPlan, setSubPlan] = useState(org.subscriptionPlan ?? 'starter');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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

      <hr className="border-gray-200" />

      {/* Profile */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Org name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-56`} />
        <span className="text-sm font-medium text-gray-700 w-36">Founder email</span>
        <input value={founderEmail} onChange={(e) => setFounderEmail(e.target.value)} className={`${inputCls} w-56`} />
        <button
          disabled={busy !== null}
          onClick={() => run('profile', () => updateOrgProfile(org.orgId, { name, founderEmail }))}
          className={`${btnCls} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
        >
          {busy === 'profile' ? '…' : 'Save profile'}
        </button>
      </div>

      {/* Auth method */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Auth method</span>
        <span className="text-sm text-gray-500 capitalize">{org.authMethod ?? '—'}</span>
        {org.authMethod === 'saml' && (
          <button
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm(`Revert "${org.name ?? org.orgId}" to email/password sign-in? Do this if their SAML setup is broken and locking people out.`)) {
                run('reset-auth', () => resetAuthMethod(org.orgId));
              }
            }}
            className={`${btnCls} bg-amber-50 text-amber-700 hover:bg-amber-100`}
          >
            {busy === 'reset-auth' ? '…' : 'Reset to email/password'}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Allowed domains</span>
        <input
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="any (blank = open)"
          className={`${inputCls} w-56`}
        />
        <button
          disabled={busy !== null}
          onClick={() => run('domains', () => updateAllowedDomains(
            org.orgId,
            org.authMethod ?? 'email',
            domains.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
          ))}
          className={`${btnCls} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
        >
          {busy === 'domains' ? '…' : 'Save'}
        </button>
      </div>

      {/* Subscription override */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Subscription</span>
        <select value={subStatus} onChange={(e) => setSubStatus(e.target.value)} className={inputCls + ' w-32'}>
          {['trialing', 'active', 'past_due', 'canceled', 'unpaid'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={subPlan} onChange={(e) => setSubPlan(e.target.value)} className={inputCls + ' w-32'}>
          {['starter', 'growth', 'enterprise'].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          disabled={busy !== null}
          onClick={() => run('subscription', () => setSubscription(org.orgId, { subscriptionStatus: subStatus, subscriptionPlan: subPlan }))}
          className={`${btnCls} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
        >
          {busy === 'subscription' ? '…' : 'Save'}
        </button>
      </div>
      <p className="text-xs text-amber-600">
        ⚠ This bypasses Stripe entirely — for orgs with a real subscription, the next webhook
        event will overwrite it. Use for comps/support fixes, not routine billing changes.
      </p>

      {/* Suspend / reinstate */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 w-36">Approval</span>
        <span className="text-sm text-gray-500">{org.approved ? 'Approved' : `Not approved (${org.reviewStatus ?? 'pending'})`}</span>
        {org.approved ? (
          <button
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm(`Suspend "${org.name ?? org.orgId}"? New signups will be blocked and it disappears from the org picker. Existing signed-in users keep their sessions.`)) {
                run('suspend', () => suspendOrg(org.orgId));
              }
            }}
            className={`${btnCls} bg-red-50 text-red-700 hover:bg-red-100`}
          >
            {busy === 'suspend' ? '…' : 'Suspend'}
          </button>
        ) : (
          <button
            disabled={busy !== null}
            onClick={() => run('reinstate', () => reinstateOrg(org.orgId))}
            className={`${btnCls} bg-green-50 text-green-700 hover:bg-green-100`}
          >
            {busy === 'reinstate' ? '…' : 'Reinstate'}
          </button>
        )}
      </div>

      <hr className="border-gray-200" />

      {/* Danger zone */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-red-700">Danger zone</span>
        {!deleteConfirmOpen ? (
          <div>
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              className={`${btnCls} bg-red-50 text-red-700 hover:bg-red-100`}
            >
              Delete organization…
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap bg-red-50 border border-red-200 rounded-lg p-3">
            <span className="text-xs text-red-700">
              Cancels their Stripe subscription and permanently deletes all org data. Type
              <strong> {org.name ?? org.orgId} </strong> to confirm:
            </span>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className={inputCls + ' w-48'}
            />
            <button
              disabled={busy !== null || deleteConfirmText !== (org.name ?? org.orgId)}
              onClick={() => run('delete', () => deleteOrg(org.orgId))}
              className={`${btnCls} bg-red-600 text-white hover:bg-red-700`}
            >
              {busy === 'delete' ? '…' : 'Permanently delete'}
            </button>
            <button onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); }} className={`${btnCls} text-gray-500 hover:text-gray-800`}>
              Cancel
            </button>
          </div>
        )}
      </div>
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
