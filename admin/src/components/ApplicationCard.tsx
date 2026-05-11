import { useState } from 'react';
import type { Application } from '../api';

const ORG_TYPE_LABELS: Record<string, string> = {
  university: 'University / College',
  k12: 'K-12 School',
  corporate: 'Corporate Campus',
  healthcare: 'Hospital / Healthcare',
  government: 'Government / Municipal',
  nonprofit: 'Non-profit',
  other: 'Other',
};

const RIDER_LABELS: Record<string, string> = {
  under_50: 'Under 50',
  '50_200': '50 – 200',
  '200_500': '200 – 500',
  '500_plus': '500+',
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-gray-800 mt-0.5">{value}</dd>
    </div>
  );
}

export default function ApplicationCard({
  application: a,
  onApprove,
  onReject,
}: {
  application: Application;
  onApprove: (orgId: string) => Promise<void>;
  onReject: (orgId: string, reason: string) => Promise<void>;
}) {
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [err, setErr] = useState('');

  const submittedDate = a.submittedAt
    ? new Date(a.submittedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const handleApprove = async () => {
    setActing('approve');
    setErr('');
    try {
      await onApprove(a.orgId);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to approve');
      setActing(null);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActing('reject');
    setErr('');
    try {
      await onReject(a.orgId, rejectReason.trim());
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to reject');
      setActing(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-gray-900">{a.name ?? a.orgId}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {ORG_TYPE_LABELS[a.orgType ?? ''] ?? a.orgType ?? '—'}
            {a.slug && <span className="ml-2 text-gray-400">· /{a.slug}</span>}
          </p>
        </div>
        {submittedDate && (
          <span className="text-xs text-gray-400 whitespace-nowrap pt-1">{submittedDate}</span>
        )}
      </div>

      {/* Details grid */}
      <div className="px-6 py-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
        <Field label="Contact" value={[a.contactFirstName, a.contactLastName].filter(Boolean).join(' ') || null} />
        <Field label="Email" value={a.founderEmail} />
        <Field label="Phone" value={a.contactPhone} />
        <Field label="Website" value={a.website} />
        <Field label="Auth method" value={a.authMethod} />
        <Field label="Est. daily riders" value={RIDER_LABELS[a.estimatedRiders ?? ''] ?? a.estimatedRiders} />
        <Field label="Heard about us" value={a.heardAboutUs} />
      </div>

      {/* Description */}
      {a.description && (
        <div className="px-6 pb-4">
          <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Description</dt>
          <dd className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 leading-relaxed">{a.description}</dd>
        </div>
      )}

      {/* Error */}
      {err && <p className="px-6 pb-2 text-sm text-red-600">{err}</p>}

      {/* Reject form */}
      {showRejectForm && (
        <div className="px-6 pb-4 space-y-2">
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            rows={2}
            placeholder="Reason for rejection (required)…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleReject}
              disabled={!rejectReason.trim() || acting === 'reject'}
              className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              {acting === 'reject' ? 'Rejecting…' : 'Confirm rejection'}
            </button>
            <button
              onClick={() => { setShowRejectForm(false); setRejectReason(''); }}
              className="px-4 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!showRejectForm && (
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={handleApprove}
            disabled={acting !== null}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {acting === 'approve' ? 'Approving…' : '✓ Approve'}
          </button>
          <button
            onClick={() => setShowRejectForm(true)}
            disabled={acting !== null}
            className="flex-1 bg-white border border-red-300 text-red-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  );
}
