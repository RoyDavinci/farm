import { money } from '@ahia/shared';
import { Check, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty } from '../ui';

interface Refund {
  id: string;
  funding_id: string;
  buyer_name: string;
  provider: string;
  amount_kobo: number;
  status: 'PENDING' | 'SENDING' | 'REFUNDED' | 'FAILED';
  provider_refund_id: string | null;
  error: string | null;
  needs_review: boolean;
  created_at: string;
}

/**
 * Refunds to buyers' cards (wallet feature off). The background job sends them; this page is for
 * the ones it could not finish: rejected by the provider, or an unknown outcome.
 */
export default function RefundsPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<Refund[]>([]);
  const load = useCallback(
    () =>
      request('get', '/admin/refunds')
        .then(setRows)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => void load(), [load]);
  const resolve = (r: Refund, outcome: 'REFUNDED' | 'RETRY') => {
    const reason = window.prompt(
      outcome === 'REFUNDED'
        ? `Mark ${money(r.amount_kobo)} as refunded. What did you confirm in the ${r.provider} dashboard? (at least 10 characters)`
        : `Send this refund again. Confirm the ${r.provider} dashboard shows NO refund for payment ${r.funding_id}. (at least 10 characters)`,
    );
    if (reason)
      void action(
        async () => {
          await request('post', '/admin/refunds/{id}/resolve', {
            params: { id: r.id },
            body: { outcome, reason },
          });
          await load();
        },
        outcome === 'REFUNDED' ? 'Refund marked as completed.' : 'Refund queued to send again.',
      );
  };
  return (
    <section className="card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Refund</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.buyer_name}</b>
                  <small>{new Date(r.created_at).toLocaleString()}</small>
                </td>
                <td>
                  <b>{money(Number(r.amount_kobo))}</b>
                  <small>
                    {r.provider} · payment {r.funding_id}
                    {r.provider_refund_id ? ` · refund ${r.provider_refund_id}` : ''}
                  </small>
                </td>
                <td>
                  <Badge status={r.status === 'REFUNDED' ? 'COMPLETED' : r.status} />
                  {r.error && <small className="error">{r.error}</small>}
                </td>
                <td>
                  {(r.status === 'FAILED' ||
                    (r.status === 'SENDING' && (r.error || r.needs_review))) && (
                    <div className="row-actions">
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() => resolve(r, 'REFUNDED')}
                      >
                        <Check size={14} /> Mark refunded
                      </button>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() => resolve(r, 'RETRY')}
                      >
                        <RotateCcw size={14} /> Send again
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty
          title="No card refunds"
          text="Refunds for cancelled or refunded orders are sent back to the buyer's card automatically and listed here."
        />
      )}
    </section>
  );
}
