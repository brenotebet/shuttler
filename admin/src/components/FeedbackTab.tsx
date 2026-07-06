import { useCallback, useEffect, useMemo, useState } from 'react';
import { listFeedback, type FeedbackEntry } from '../api';
import RefreshButton from './RefreshButton';

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
      {'★'.repeat(Math.round(rating))}
      <span className="text-gray-200">{'★'.repeat(Math.max(0, 5 - Math.round(rating)))}</span>
    </span>
  );
}

function questionLabel(f: FeedbackEntry): string {
  return QUESTION_LABELS[f.questionKey ?? ''] ?? f.question ?? '—';
}

export default function FeedbackTab() {
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orgFilter, setOrgFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setFeedback(await listFeedback());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const orgIds = useMemo(
    () => [...new Set(feedback.map((f) => f.orgId).filter((o): o is string => !!o))],
    [feedback],
  );

  const filtered = useMemo(
    () => (orgFilter === 'all' ? feedback : feedback.filter((f) => f.orgId === orgFilter)),
    [feedback, orgFilter],
  );

  // Per-question aggregates over rated responses
  const aggregates = useMemo(() => {
    const byQuestion = new Map<string, { sum: number; count: number }>();
    for (const f of filtered) {
      if (f.rating == null) continue;
      const key = questionLabel(f);
      const agg = byQuestion.get(key) ?? { sum: 0, count: 0 };
      agg.sum += f.rating;
      agg.count += 1;
      byQuestion.set(key, agg);
    }
    return [...byQuestion.entries()]
      .map(([label, { sum, count }]) => ({ label, avg: sum / count, count }))
      .sort((a, b) => a.avg - b.avg); // worst first — that's where the work is
  }, [filtered]);

  const comments = useMemo(
    () => filtered.filter((f) => f.answer && f.answer.trim().length > 0),
    [filtered],
  );

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Rider Feedback</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} responses`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {orgIds.length > 1 && (
            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="all">All orgs</option>
              {orgIds.map((id) => (
                <option key={id} value={id}>{id.slice(0, 8)}…</option>
              ))}
            </select>
          )}
          <RefreshButton onClick={load} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}

      {loading && <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>}

      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-20 text-gray-400">
          <p className="font-medium">No feedback yet</p>
          <p className="text-sm mt-1">Responses appear here after riders complete a pickup.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          {/* Aggregates — sorted worst-first */}
          {aggregates.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {aggregates.map((a) => (
                <div key={a.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-medium text-gray-500 mb-1">{a.label}</p>
                  <p className={`text-2xl font-bold ${a.avg < 3.5 ? 'text-red-600' : 'text-gray-900'}`}>
                    {a.avg.toFixed(1)}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <Stars rating={a.avg} />
                    <span className="text-xs text-gray-400">{a.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Free-text comments — churn signals live here */}
          {comments.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Comments ({comments.length})</h3>
              <div className="space-y-2">
                {comments.map((f) => (
                  <div key={f.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                    <p className="text-sm text-gray-800">“{f.answer}”</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {questionLabel(f)} · {f.orgId ? `${f.orgId.slice(0, 8)}…` : '—'} · {fmtDate(f.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw table */}
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
                {filtered.map((f, i) => (
                  <tr key={f.id} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="px-4 py-3 text-gray-700">{questionLabel(f)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {f.rating != null ? <Stars rating={f.rating} /> : (f.answer ?? '—')}
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
        </>
      )}
    </>
  );
}
