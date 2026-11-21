import { useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function PoliciesPage() {
  const { action, busy, setError } = useAdmin();
  const [draft, setDraft] = useState<any>(null),
    [approved, setApproved] = useState<any>({}),
    [reason, setReason] = useState('');
  const load = () =>
    request('get', '/admin/policies').then((p) => {
      setDraft(p.draft);
      setApproved(p.approved);
    });
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  if (!draft) return <p>Loading proposed policies…</p>;
  return (
    <section className="card">
      <h2>Proposed operating policies</h2>
      <p>
        Financial, inspection and liability values are draft proposals for owner/provider review.
        Saving drafts does not enable live money, penalties, third-party funding restrictions or
        automatic party debits. No-show penalties remain zero; return costs require a reviewed case.
      </p>
      {[
        ['inspection_minutes', 'Inspection window (minutes)'],
        ['pod_max_kobo', 'Digital POD limit (kobo)'],
        ['stock_stale_days', 'Hide stock after days (0 disables)'],
        ['stock_reminder_days', 'Remind seller after days'],
        ['appeal_days', 'Appeal window (days)'],
      ].map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={0}
            value={draft[key] ?? 0}
            onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <label>
        Third-party funding proposal
        <select
          value={draft.third_party_funding}
          onChange={(e) => setDraft({ ...draft, third_party_funding: e.target.value })}
        >
          <option value="REVIEW">Review with provider</option>
          <option value="DENY">Restrict when identity matching is supported</option>
        </select>
      </label>
      <button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            await request('put', '/admin/policies', { body: draft });
            await load();
          }, 'Draft policy saved; financial rules remain inactive.')
        }
      >
        Save proposal
      </button>
      <h3>Stock freshness</h3>
      <p>
        Currently active: hide after {approved.stock_stale_days || 'no'} days; reminders after{' '}
        {approved.stock_reminder_days || 'no'} days. This control affects catalogue visibility only.
      </p>
      <label>
        Reason for activating stock rules
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button
        disabled={busy || reason.trim().length < 5}
        onClick={() =>
          void action(async () => {
            await request('post', '/admin/policies/approve-stock', { body: { reason } });
            await load();
          }, 'Stock freshness rules activated.')
        }
      >
        Activate saved stock rules
      </button>
    </section>
  );
}
