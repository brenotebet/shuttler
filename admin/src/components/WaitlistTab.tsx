import { useCallback, useEffect, useState } from 'react';
import { listWaitlist, type WaitlistEntry } from '../api';
import RefreshButton from './RefreshButton';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function WaitlistTab() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await listWaitlist());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Waitlist</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${entries.length} signups — your sales leads`}
          </p>
        </div>
        <RefreshButton onClick={load} loading={loading} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}

      {!loading && entries.length === 0 && !error && (
        <div className="text-center py-20 text-gray-400">
          <p className="font-medium">No signups yet</p>
          <p className="text-sm mt-1">Waitlist submissions from shuttler.net appear here.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Source</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <a href={`mailto:${e.email}`} className="hover:text-indigo-600">{e.email ?? '—'}</a>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{e.source ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(e.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
