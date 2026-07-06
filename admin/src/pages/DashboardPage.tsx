import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { listApplications, approveOrg, rejectOrg, type Application } from '../api';
import ApplicationCard from '../components/ApplicationCard';
import OrgsTab from '../components/OrgsTab';
import FeedbackTab from '../components/FeedbackTab';
import WaitlistTab from '../components/WaitlistTab';
import RefreshButton from '../components/RefreshButton';

type Tab = 'applications' | 'orgs' | 'feedback' | 'waitlist';

export default function DashboardPage({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<Tab>('applications');

  // Applications state
  const [apps, setApps] = useState<Application[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState('');

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    setAppsError('');
    try {
      setApps(await listApplications());
    } catch (e: any) {
      setAppsError(e?.message ?? 'Failed to load applications');
    } finally {
      setAppsLoading(false);
    }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

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

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-6">
        <nav className="flex gap-1 -mb-px">
          {([
            { key: 'applications', label: 'Applications' },
            { key: 'orgs', label: 'Orgs' },
            { key: 'feedback', label: 'Rider Feedback' },
            { key: 'waitlist', label: 'Waitlist' },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
              {t.key === 'applications' && apps.length > 0 && (
                <span className="ml-2 bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {apps.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === 'applications' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Org Applications</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {appsLoading ? 'Loading…' : `${apps.length} pending`}
                </p>
              </div>
              <RefreshButton onClick={loadApps} loading={appsLoading} />
            </div>
            {appsError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
                {appsError}
              </div>
            )}
            {!appsLoading && apps.length === 0 && !appsError && (
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
          </>
        )}

        {activeTab === 'orgs' && <OrgsTab />}
        {activeTab === 'feedback' && <FeedbackTab />}
        {activeTab === 'waitlist' && <WaitlistTab />}
      </main>
    </div>
  );
}
