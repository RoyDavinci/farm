import { useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function DeliveryOperationsPage({ mode }: { mode: 'tariffs' | 'incidents' }) {
  const { action, busy, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState<any>({
      state: '',
      city: '',
      vehicle_type: 'motorcycle',
      active: false,
      base_kobo: 50000,
      per_km_kobo: 10000,
      per_kg_kobo: 0,
      max_weight_kg: 25,
      waiting_per_minute_kobo: 0,
      demand_bps: 10000,
      surcharge_kobo: 0,
      reason: '',
    }),
    [notes, setNotes] = useState<Record<string, string>>({});
  const load = () =>
    mode === 'tariffs'
      ? request('get', '/admin/tariffs').then(setRows)
      : request('get', '/admin/incidents').then(setRows);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [mode]);
  return (
    <section className="card">
      <h2>
        {mode === 'tariffs'
          ? 'Regional delivery fares and vehicle availability'
          : 'Delivery safety and incident review'}
      </h2>
      {mode === 'tariffs' ? (
        <>
          <p>
            Amounts are in kobo. Buyers see the breakdown and must confirm a changed price. Waiting
            is quoted upfront; there are no automatic after-trip debits. An inactive regional rule
            blocks that vehicle in that area.
          </p>
          {[
            ['state', 'State'],
            ['city', 'City'],
            ['vehicle_type', 'Vehicle code'],
            ['base_kobo', 'Base fare'],
            ['per_km_kobo', 'Per km'],
            ['per_kg_kobo', 'Per kg'],
            ['max_weight_kg', 'Maximum kg'],
            ['waiting_per_minute_kobo', 'Per waiting minute'],
            ['demand_bps', 'Demand multiplier (10000 = 1×)'],
            ['surcharge_kobo', 'Disclosed surcharge'],
            ['reason', 'Explanation shown with quote'],
          ].map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                type={typeof form[k] === 'number' ? 'number' : 'text'}
                value={form[k]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [k]: typeof form[k] === 'number' ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Vehicle permitted in this pickup area
          </label>
          <button
            disabled={busy || !form.state || !form.city || form.reason.trim().length < 5}
            onClick={() =>
              void action(async () => {
                await request('put', '/admin/tariffs', { body: form });
                await load();
              }, 'Regional fare saved.')
            }
          >
            Save regional fare
          </button>
          {rows.map((r) => (
            <div className="settings-card" key={r.id}>
              <h3>
                {r.city}, {r.state} · {r.vehicle_type} · {r.active ? 'Enabled' : 'Unavailable'}
              </h3>
              <p>{r.reason}</p>
              <button onClick={() => setForm(r)}>Edit</button>
            </div>
          ))}
        </>
      ) : (
        rows.map((r) => (
          <div className="settings-card" key={r.id}>
            <h3>
              {r.title} · {r.kind} · {r.status}
            </h3>
            <p>Case {r.id}</p>
            <p>{r.description}</p>
            <p>{r.resolution}</p>
            {r.status === 'OPEN' && (
              <>
                <label>
                  Reviewed outcome
                  <textarea
                    value={notes[r.id] || ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  />
                </label>
                <button
                  disabled={busy || (notes[r.id] || '').trim().length < 10}
                  onClick={() =>
                    void action(async () => {
                      await request('post', '/admin/incidents/{id}/resolve', {
                        params: { id: r.id },
                        body: { resolution: notes[r.id] },
                      });
                      await load();
                    }, 'Incident resolution recorded.')
                  }
                >
                  Record outcome
                </button>
              </>
            )}
          </div>
        ))
      )}
    </section>
  );
}
