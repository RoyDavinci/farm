import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { request } from '../api';

const roleLabel: Record<string, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  staff: 'Staff',
  system: 'Ahia',
};
const kindLabel: Record<string, string> = {
  MESSAGE: 'Message',
  INTERNAL: 'Internal note',
  UPDATE: 'Update to both parties',
  SYSTEM: 'Case event',
};

/**
 * Case management for one support case: owner and priority, the order snapshot taken when the
 * case opened, and the shared timeline with internal staff notes.
 */
export default function CaseManagement({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      request('get', '/disputes/{id}/timeline', { params: { id } })
        .then(setData)
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
    void request('get', '/admin/disputes/assignees')
      .then(setStaff)
      .catch(() => {});
  }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <p>Loading case history…</p>;
  const snap = data.snapshot || {};
  return (
    <div className="case-management">
      {error && <div className="alert error">{error}</div>}
      <div className="case-controls">
        <label>
          Owner
          <select
            value={data.assigned_to || ''}
            disabled={busy}
            onChange={(e) =>
              void act(() =>
                request('post', '/admin/disputes/{id}/assign', {
                  params: { id },
                  body: { staff_id: e.target.value || null },
                }),
              )
            }
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.staff_role})
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={data.priority}
            disabled={busy}
            onChange={(e) =>
              void act(() =>
                request('post', '/admin/disputes/{id}/assign', {
                  params: { id },
                  body: { staff_id: data.assigned_to, priority: e.target.value as any },
                }),
              )
            }
          >
            {['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((p) => (
              <option key={p} value={p}>
                {p[0] + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      {snap.booking_id && (
        <div className="case-snapshot">
          <h3>Order at the time of the complaint</h3>
          <dl>
            <dt>Seller</dt>
            <dd>
              {snap.business_name}
              {snap.legal_name ? ` (${snap.legal_name})` : ''} · {snap.area}, {snap.city} ·
              verification: {String(snap.verification_status || 'NONE').toLowerCase()}
            </dd>
            <dt>Item</dt>
            <dd>
              {snap.title}
              {snap.variant_name && snap.variant_name !== 'Standard'
                ? ` · ${snap.variant_name}`
                : ''}{' '}
              · {snap.quantity} {snap.unit} at {money(Number(snap.price_kobo || 0))}
            </dd>
            <dt>Total</dt>
            <dd>
              {money(Number(snap.total_kobo || 0))} · {snap.paid ? 'paid' : 'not paid'}
              {snap.payment_references?.length
                ? ` · payment ${snap.payment_references.join(', ')}`
                : ''}
            </dd>
            <dt>Ordered</dt>
            <dd>{snap.ordered_at ? new Date(snap.ordered_at).toLocaleString() : '—'}</dd>
          </dl>
        </div>
      )}
      <h3>Timeline</h3>
      <ol className="case-timeline">
        {data.notes.map((n: any) => (
          <li key={n.id} className={`case-note ${n.kind.toLowerCase()}`}>
            <div>
              <b>{n.author_name || roleLabel[n.author_role]}</b>{' '}
              <span>
                {roleLabel[n.author_role]} · {kindLabel[n.kind]} ·{' '}
                {new Date(n.created_at).toLocaleString()}
              </span>
            </div>
            <p>{n.body}</p>
          </li>
        ))}
      </ol>
      <label>
        Add a note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
      </label>
      <label className="inline">
        <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
        Internal (staff only). Untick to send this as an update to the buyer and seller.
      </label>
      <button
        disabled={busy || note.trim().length < 2}
        onClick={() =>
          void act(async () => {
            await request('post', '/admin/disputes/{id}/notes', {
              params: { id },
              body: { body: note.trim(), internal },
            });
            setNote('');
          })
        }
      >
        {internal ? 'Add internal note' : 'Send update'}
      </button>
    </div>
  );
}
