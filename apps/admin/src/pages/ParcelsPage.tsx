import { useEffect, useState } from 'react';
import { money } from '@zuru/shared';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function ParcelsPage() {
  const { action, busy, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({});
  const load = () => request('get', '/admin/parcels').then(setRows);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Independent parcel deliveries</h2>
      <p>
        Development pilot; no live parcel charges are enabled. Pickup and delivery PINs are private
        to the sender. Support pauses do not automatically debit or refund either party.
      </p>
      {rows.map((p) => (
        <div key={p.id} className="settings-card">
          <h3>
            {p.description} · {p.status}
          </h3>
          <p>
            {p.pickup_address} → {p.dropoff_address}
          </p>
          <p>
            {money(p.fare_kobo)} · {p.distance_km} km · {p.vehicle_type}
          </p>
          <p>{p.review_note}</p>
          <label>
            Reviewed instructions
            <textarea
              value={notes[p.id] || ''}
              onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
            />
          </label>
          {[false, true].map((release) => (
            <button
              key={String(release)}
              disabled={busy || (notes[p.id] || '').trim().length < 10}
              onClick={() =>
                void action(async () => {
                  await request('post', '/admin/parcels/{id}/review', {
                    params: { id: p.id },
                    body: { release_pause: release, resolution: notes[p.id] },
                  });
                  await load();
                }, 'Parcel review updated.')
              }
            >
              {release ? 'Release support pause' : 'Keep paused with instructions'}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
