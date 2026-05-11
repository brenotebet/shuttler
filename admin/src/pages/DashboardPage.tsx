import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { listApplications, approveOrg, rejectOrg, type Application } from '../api';
import ApplicationCard from '../components/ApplicationCard';

export default function DashboardPage({ user }: { user: User }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setApps(await listApplications());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (orgId: string) => {
    await approveOrg(orgId);
    setApps((prev) => prev.filter((a) => a.orgId !== orgId));
  };

  const handleReject = async (orgId: string, reason: string) => {
    await rejectOrg(orgId, reason);
    setApps((prev) => prev.filter((a) => a.orgId !== orgId));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-indigo-600">Shuttler</span>
          <span className="text-gray-300">|</span>
          <span className="text-sm font-medium text-gray-600">Admin Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <button
            onClick={() => auth.signOut()}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Org Applications</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${apps.length} pending`}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-40 transition-colors font-medium"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* List */}
        {!loading && apps.length === 0 && !error && (
          <div className="text-center py-20 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">All caught up</p>
            <p className="text-sm mt-1">No pending applications.</p>
          </div>
        )}

        <div className="space-y-4">
          {apps.map((app) => (
            <ApplicationCard
              key={app.orgId}
              application={app}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
