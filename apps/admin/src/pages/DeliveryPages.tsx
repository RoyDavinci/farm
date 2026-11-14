import { money, statusLabel } from '@farmers-market/shared';
import { ArrowUpRight, Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty, Modal } from '../ui';
import { SellerDocuments } from './Modals';

function useList<T>(path: '/admin/drivers' | '/admin/deliveries' | '/admin/vehicle-types') {
  const { setError } = useAdmin();
  const [rows, setRows] = useState<T[]>([]);
  const load = useCallback(
    () => (request('get', path) as Promise<T[]>).then(setRows).catch((e) => setError(e.message)),
    [path, setError],
  );
  useEffect(() => void load(), [load]);
  return [rows, load] as const;
}

export function DriversPage() {
  const { busy, action } = useAdmin();
  const [rows, load] = useList<any>('/admin/drivers');
  const [review, setReview] = useState<any>(null);
  const [reason, setReason] = useState('');
  return (
    <section className="card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>City</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.user_id}>
                <td>
                  <b>{d.name}</b>
                  <small>
                    {d.email} · {d.phone}
                  </small>
                </td>
                <td>
                  {d.vehicle_name}
                  <small>
                    {d.plate_number} · licence {d.licence_number}
                  </small>
                </td>
                <td>
                  {d.city}
                  <small>{d.online ? 'Online now' : 'Offline'}</small>
                </td>
                <td>
                  <Badge status={d.status} />
                </td>
                <td>
                  <button
                    className="secondary compact"
                    onClick={() => {
                      setReview(d);
                      setReason('');
                    }}
                  >
                    Review <ArrowUpRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty title="No drivers yet" text="Driver applications from the app appear here." />
      )}
      {review && (
        <Modal title="Driver verification" close={() => setReview(null)}>
          <h2>{review.name}</h2>
          <Badge status={review.status} />
          <dl>
            <dt>Vehicle</dt>
            <dd>
              {review.vehicle_name} · {review.plate_number}
            </dd>
            <dt>Licence number</dt>
            <dd>{review.licence_number}</dd>
            <dt>City</dt>
            <dd>{review.city}</dd>
          </dl>
          <SellerDocuments sellerId={review.user_id} subject="driver" />
          <label>
            Decision reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Record the licence and vehicle checks completed"
            />
          </label>
          <div className="modal-actions">
            {(['REJECTED', 'SUSPENDED', 'APPROVED'] as const).map((status) => (
              <button
                key={status}
                disabled={busy || reason.trim().length < 3}
                className={status === 'APPROVED' ? 'primary' : 'secondary'}
                onClick={() =>
                  void action(
                    async () => {
                      await request('post', '/admin/drivers/{id}/review', {
                        params: { id: review.user_id },
                        body: {
                          status,
                          reason,
                        },
                      });
                      setReview(null);
                      await load();
                    },
                    `Driver ${statusLabel(status)}.`,
                  )
                }
              >
                {status === 'APPROVED' ? 'Approve driver' : statusLabel(status)}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

export function DeliveriesPage() {
  const [rows] = useList<any>('/admin/deliveries');
  return (
    <section className="card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Driver</th>
              <th>Trip</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <b>{d.title}</b>
                  <small>
                    {d.business_name} → {d.buyer_name}
                  </small>
                </td>
                <td>
                  {d.driver_name || '—'}
                  <small>{d.vehicle_name}</small>
                </td>
                <td>
                  {money(Number(d.fare_kobo))}
                  <small>
                    {d.distance_km} km{d.pay_on_delivery ? ' · Pay on Delivery' : ''}
                    {d.fare_paid ? '' : ' · unpaid'}
                  </small>
                </td>
                <td>
                  <Badge status={d.status} />
                  {d.cancel_reason && <small>{d.cancel_reason}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty title="No deliveries yet" text="Buyers can request delivery on accepted bookings." />
      )}
    </section>
  );
}

/** Owner-only fare table. Fares are configuration, never hard-coded. */
export function VehicleTypesCard() {
  const { busy, action } = useAdmin();
  const [rows, load] = useList<any>('/admin/vehicle-types');
  return (
    <section className="card settings-card">
      <h2>Delivery vehicles & fares</h2>
      <p>Fare = base + per km (road distance estimate), never below the minimum.</p>
      {rows.map((v) => (
        <form
          key={v.code}
          className="fare-row"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const kobo = (name: string) => Math.round(Number(f.get(name)) * 100);
            void action(async () => {
              await request('put', '/admin/vehicle-types/{code}', {
                params: { code: v.code },
                body: {
                  name: v.name,
                  base_fare_kobo: kobo('base'),
                  per_km_kobo: kobo('perKm'),
                  min_fare_kobo: kobo('min'),
                  max_km: Number(f.get('maxKm')),
                  active: f.get('active') === 'on',
                },
              });
              await load();
            }, `${v.name} fares saved.`);
          }}
        >
          <b>{v.name}</b>
          <label>
            Base ₦
            <input
              name="base"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.base_fare_kobo / 100}
            />
          </label>
          <label>
            Per km ₦
            <input
              name="perKm"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.per_km_kobo / 100}
            />
          </label>
          <label>
            Minimum ₦
            <input
              name="min"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.min_fare_kobo / 100}
            />
          </label>
          <label>
            Max km
            <input name="maxKm" type="number" min="1" defaultValue={v.max_km} />
          </label>
          <label className="inline">
            <input name="active" type="checkbox" defaultChecked={v.active} /> Active
          </label>
          <button className="secondary compact" disabled={busy}>
            <Check size={14} /> Save
          </button>
        </form>
      ))}
    </section>
  );
}
