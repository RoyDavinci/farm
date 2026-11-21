import { money } from '@ahia/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty } from '../ui';

export default function PromotionsPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(
    () =>
      (request('get', '/admin/promotions') as Promise<any[]>)
        .then(setRows)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => void load(), [load]);
  return (
    <section className="card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>Period</th>
              <th>Fee</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.title}</b>
                  <small>{p.business_name}</small>
                </td>
                <td>
                  {new Date(p.starts_at).toLocaleDateString()} –{' '}
                  {new Date(p.ends_at).toLocaleDateString()}
                  <small>{p.days} days</small>
                </td>
                <td>
                  {money(Number(p.fee_kobo))}
                  {Number(p.refund_kobo) > 0 && (
                    <small>{money(Number(p.refund_kobo))} refunded</small>
                  )}
                </td>
                <td>
                  <Badge
                    status={p.running ? 'ACTIVE' : p.status === 'CANCELLED' ? 'CANCELLED' : 'ENDED'}
                  />
                  {p.cancel_reason && <small>{p.cancel_reason}</small>}
                </td>
                <td>
                  {p.running && (
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          'Reason for stopping this sponsored listing (shown to the seller)',
                        );
                        if (reason)
                          void action(async () => {
                            await request('post', '/admin/promotions/{id}/cancel', {
                              params: { id: p.id },
                              body: { reason },
                            });
                            await load();
                          }, 'Promotion stopped; unused days refunded to the seller.');
                      }}
                    >
                      <X size={14} /> Stop
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty
          title="No sponsored listings yet"
          text="Sellers can sponsor a listing from the app. Fees come from their proceeds."
        />
      )}
    </section>
  );
}
