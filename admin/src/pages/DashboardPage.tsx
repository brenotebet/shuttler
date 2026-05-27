import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { listApplications, approveOrg, rejectOrg, listFeedback, type Application, type FeedbackEntry } from '../api';
import ApplicationCard from '../components/ApplicationCard';

type Tab = 'applications' | 'feedback';

const QUESTION_LABELS: Record<string, string> = {
  eta_accuracy: 'ETA accuracy',
  service_rating: 'Driver service',
  overall_experience: 'Overall experience',
  app_ease: 'App ease of use',
  punctuality: 'Punctuality',
  would_use_again: 'Would use again',
  wait_time: 'Wait time',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400">
      {'★'.repeat(rating)}
      <span className="text-gray-200">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

export default function DashboardPage({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<Tab>('applications');

  // Applications state
  const [apps, setApps] = useState<Application[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState('');

  // Feedback state
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

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

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError('');
    try {
      setFeedback(await listFeedback());
    } catch (e: any) {
      setFeedbackError(e?.message ?? 'Failed to load feedback');
    } finally {
      setFeedbackLoading(false);
    }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  useEffect(() => {
    if (activeTab === 'feedback' && feedback.length === 0 && !feedbackLoading) {
      loadFeedback();
    }
  }, [activeTab]);

  const handleApprove = async (orgId: string) => {
    await approveOrg(orgId);
    setApps((prev) => prev.filter((a) => a.orgId !== orgId));
  };

  const handleReject = async (orgId: string, reason: string) => {
    await rejectOrg(orgId, reason);
    setApps((prev) => prev.filter((a) => a.orgId !== orgId));
  };

  const isLoading = activeTab === 'applications' ? appsLoading : feedbackLoading;

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
            { key: 'applications', label: 'Org Applications' },
            { key: 'feedback', label: 'Rider Feedback' },
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

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Section header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            {activeTab === 'applications' ? (
              <>
                <h2 className="text-xl font-bold text-gray-900">Org Applications</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {appsLoading ? 'Loading…' : `${apps.length} pending`}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-gray-900">Rider Feedback</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {feedbackLoading ? 'Loading…' : `${feedback.length} responses`}
                </p>
              </>
            )}
          </div>
          <button
            onClick={activeTab === 'applications' ? loadApps : loadFeedback}
            disabled={isLoading}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-40 transition-colors font-medium"
          >
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Applications tab */}
        {activeTab === 'applications' && (
          <>
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

        {/* Feedback tab */}
        {activeTab === 'feedback' && (
          <>
            {feedbackError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
                {feedbackError}
              </div>
            )}
            {feedbackLoading && (
              <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
            )}
            {!feedbackLoading && feedback.length === 0 && !feedbackError && (
              <div className="text-center py-20 text-gray-400">
                <p className="font-medium">No feedback yet</p>
                <p className="text-sm mt-1">Responses appear here after riders complete a pickup.</p>
              </div>
            )}
            {!feedbackLoading && feedback.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Question</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Response</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Org</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedback.map((f, i) => (
                      <tr key={f.id} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                        <td className="px-4 py-3 text-gray-700">
                          {QUESTION_LABELS[f.questionKey ?? ''] ?? f.question ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {f.rating != null ? (
                            <Stars rating={f.rating} />
                          ) : (
                            f.answer ?? '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden sm:table-cell">
                          {f.orgId ? f.orgId.slice(0, 8) + '…' : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-400 hidden md:table-cell whitespace-nowrap">
                          {fmtDate(f.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
