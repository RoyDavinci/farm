import { money, type ShoppingRequest, type ShoppingDetail } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty } from '../ui';

export default function ShoppingPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<ShoppingRequest[]>([]),
    [selected, setSelected] = useState<ShoppingDetail | null>(null),
    [reason, setReason] = useState('');
  const load = useCallback(
    () =>
      request('get', '/admin/shopping')
        .then(setRows)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void request('get', '/shopping/{id}', { params: { id: selectedId } })
        .then((detail) => {
          if (!cancelled) setSelected(detail);
        })
        .catch(() => {});
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId]);
  const review = (pause: boolean) =>
    action(
      async () => {
        if (!selected) return;
        await request('post', '/admin/shopping/{id}/review', {
          params: { id: selected.id },
          body: { pause, reason },
        });
        setSelected(await request('get', '/shopping/{id}', { params: { id: selected.id } }));
        await load();
      },
      pause ? 'Shopping request paused for support.' : 'Shopping request resumed.',
    );
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Shopping requests</h2>
          <p>
            Goods sourced by a selected rider, with a buyer’s spending limit and a separate delivery
            fee.
          </p>
        </div>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Buyer / rider</th>
              <th>Budget and fee</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.source_name}</b>
                  <small>{r.items}</small>
                </td>
                <td>
                  {r.buyer_name}
                  <small>{r.rider_name}</small>
                </td>
                <td>
                  {money(r.goods_budget_kobo)} goods limit
                  <small>
                    {money(r.delivery_fee_kobo)} delivery ·{' '}
                    {r.payment_mode === 'ADVANCE' ? 'App advance' : 'Rider reimbursement'}
                  </small>
                </td>
                <td>
                  <Badge status={r.status} />
                  {r.review_open && <small className="error">Support review</small>}
                </td>
                <td>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      void request('get', '/shopping/{id}', { params: { id: r.id } })
                        .then((d) => {
                          setSelected(d);
                          setReason('');
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    Review request
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty
          title="No shopping requests yet"
          text="Requests to buy and deliver goods appear here."
        />
      )}
      {selected && (
        <div className="settings-card">
          <div className="card-head">
            <h2>{selected.source_name}</h2>
            <button className="secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p>
            <b>Buy:</b> {selected.items}
          </p>
          <p>
            <b>From:</b> {selected.source_address}
          </p>
          <p>
            <b>To:</b> {selected.dropoff_address}
          </p>
          <p>
            Goods limit {money(selected.goods_budget_kobo)} · Delivery{' '}
            {money(selected.delivery_fee_kobo)}
          </p>
          <p>
            Actual goods cost:{' '}
            {selected.actual_goods_kobo == null
              ? 'Not recorded'
              : money(selected.actual_goods_kobo)}{' '}
            ·{' '}
            {selected.payment_mode === 'ADVANCE'
              ? 'Request-linked goods advance'
              : 'Reimburse rider after delivery'}
          </p>
          <p>{selected.receipt_note}</p>
          <h3>Receipt photos</h3>
          {selected.receipt_photos.map((photo) => (
            <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
              <img
                src={photo.url}
                alt="Purchase receipt"
                style={{ maxWidth: 280, maxHeight: 320, objectFit: 'contain', margin: 8 }}
              />
            </a>
          ))}
          {!selected.receipt_photos.length && <p>No receipt photos attached.</p>}
          {selected.tracking && (
            <p>
              Last rider location: {selected.tracking.latitude.toFixed(5)},{' '}
              {selected.tracking.longitude.toFixed(5)} ·{' '}
              {new Date(selected.tracking.updated_at).toLocaleString()}. Locations older than one
              minute may be out of date.
            </p>
          )}
          <p>{selected.review_note}</p>
          <h3>Request messages</h3>
          {selected.messages.map((m) => (
            <p key={m.id}>
              <b>{m.sender_name}:</b> {m.body}
            </p>
          ))}
          <p>
            Pausing prevents new funding, advance requests, purchases and delivery confirmation. An
            advance already paid out must be returned by the rider before cancellation is refunded.
          </p>
          <label>
            Support reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={1000}
            />
          </label>
          {!['CANCELLED', 'DELIVERED'].includes(selected.status) && (
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy || reason.trim().length < 5}
                onClick={() => void review(true)}
              >
                Pause for review
              </button>
              <button
                className="primary"
                disabled={busy || reason.trim().length < 5 || !selected.review_open}
                onClick={() => void review(false)}
              >
                Resume request
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
