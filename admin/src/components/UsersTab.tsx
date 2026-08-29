import { useCallback, useEffect, useState } from 'react';
import {
  listOrgs,
  getOrgUsers,
  setUserRole,
  removeUser,
  searchUsersByEmail,
  type OrgSummary,
  type OrgMember,
  type UserSearchResult,
} from '../api';
import RefreshButton from './RefreshButton';

const ROLE_COLORS: Record<string, string> = {
  student: 'bg-blue-100 text-blue-700',
  driver: 'bg-amber-100 text-amber-700',
  admin: 'bg-green-100 text-green-700',
  parent: 'bg-teal-100 text-teal-700',
};

function RoleBadge({ role }: { role: string | null }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[role ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
      {role ?? '—'}
    </span>
  );
}

function EmailSearch({ onJumpToOrg }: { onJumpToOrg: (orgId: string) => void }) {
  const [email, setEmail] = useState('');
  const [results, setResults] = useState<UserSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback(async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      setResults(await searchUsersByEmail(email.trim()));
    } catch (e: any) {
      setError(e?.message ?? 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
      <p className="text-sm font-medium text-gray-700 mb-2">Find a user by email (across all orgs)</p>
      <div className="flex items-center gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="name@example.com"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <button
          onClick={search}
          disabled={loading || !email.trim()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      {results !== null && (
        <div className="mt-3 space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-gray-400">No matches.</p>
          ) : (
            results.map((r) => (
              <div key={`${r.orgId}-${r.uid}`} className="flex items-center gap-3 text-sm border border-gray-100 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-900 flex-1">{r.displayName ?? r.email ?? r.uid}</span>
                <RoleBadge role={r.role} />
                <button onClick={() => onJumpToOrg(r.orgId)} className="text-indigo-600 hover:text-indigo-800 font-medium">
                  {r.orgName ?? r.orgId.slice(0, 8)} →
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MemberRow({ orgId, member, onChanged }: { orgId: string; member: OrgMember; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changeRole = async (role: 'student' | 'driver' | 'admin') => {
    if (role === member.role) return;
    setBusy(true);
    setError('');
    try {
      await setUserRole(orgId, member.uid, role);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to change role');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${member.displayName ?? member.email ?? member.uid} from this org?`)) return;
    setBusy(true);
    setError('');
    try {
      await removeUser(orgId, member.uid);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-gray-50">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{member.displayName ?? '—'}</p>
        <p className="text-xs text-gray-400">{member.email ?? member.uid}</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-4 py-3">
        {member.role === 'parent' ? (
          <RoleBadge role={member.role} />
        ) : (
          <select
            value={member.role}
            disabled={busy}
            onChange={(e) => changeRole(e.target.value as 'student' | 'driver' | 'admin')}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-40"
          >
            {['student', 'driver', 'admin'].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          disabled={busy}
          onClick={remove}
          className="text-sm text-red-600 hover:text-red-800 disabled:opacity-40"
        >
          {busy ? '…' : 'Remove'}
        </button>
      </td>
    </tr>
  );
}

export default function UsersTab() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true);
    try {
      const data = await listOrgs();
      setOrgs(data);
      setSelectedOrgId((prev) => prev || data[0]?.orgId || '');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load orgs');
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const loadMembers = useCallback(async () => {
    if (!selectedOrgId) { setMembers([]); return; }
    setMembersLoading(true);
    setError('');
    try {
      setMembers(await getOrgUsers(selectedOrgId));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load users');
    } finally {
      setMembersLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const selectedOrg = orgs.find((o) => o.orgId === selectedOrgId);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500 mt-0.5">Look up any user, or browse an org's member list.</p>
        </div>
        <RefreshButton onClick={loadMembers} loading={membersLoading} />
      </div>

      <EmailSearch onJumpToOrg={setSelectedOrgId} />

      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium text-gray-700">Org</span>
        <select
          value={selectedOrgId}
          onChange={(e) => setSelectedOrgId(e.target.value)}
          disabled={orgsLoading}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          {orgs.map((o) => (
            <option key={o.orgId} value={o.orgId}>{o.name ?? o.orgId}</option>
          ))}
        </select>
        {selectedOrg && <span className="text-xs text-gray-400">{members.length} members</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}

      {!membersLoading && selectedOrgId && members.length === 0 && !error && (
        <div className="text-center py-20 text-gray-400">
          <p className="font-medium">No members in this org yet</p>
        </div>
      )}

      {members.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow key={m.uid} orgId={selectedOrgId} member={m} onChanged={loadMembers} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
