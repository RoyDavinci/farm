import { useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function RegionsPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState({
      code: '',
      country: '',
      currency: '',
      locale: '',
      enabled: false,
      cities: '',
      notes: '',
    });
  const load = () => request('get', '/admin/regions').then(setRows);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Markets and expansion configuration</h2>
      <p>
        Nigeria/NGN remains the active marketplace. Additional countries, currencies and locale
        settings can be drafted here, but activation is blocked until payment-provider, localisation
        and operating arrangements are approved. Pilot cities are planning metadata; vehicle
        restrictions use regional fare controls.
      </p>
      {(['code', 'country', 'currency', 'locale', 'cities', 'notes'] as const).map((k) => (
        <label key={k}>
          {
            {
              code: 'Country code (e.g. NG)',
              country: 'Country name',
              currency: 'Currency code (e.g. NGN)',
              locale: 'Locale (e.g. en-NG)',
              cities: 'Pilot cities (comma separated)',
              notes: 'Planning notes',
            }[k]
          }
          <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Enabled
      </label>
      <button
        disabled={busy || form.code.length !== 2 || form.currency.length !== 3}
        onClick={() =>
          void action(async () => {
            await request('put', '/admin/regions', {
              body: {
                ...form,
                cities: form.cities
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              },
            });
            await load();
          }, 'Region configuration saved.')
        }
      >
        Save region
      </button>
      {rows.map((r) => (
        <div className="settings-card" key={r.code}>
          <h3>
            {r.country} · {r.currency} · {r.enabled ? 'Active' : 'Draft'}
          </h3>
          <p>{r.cities.join(' · ')}</p>
          <p>{r.notes}</p>
          <button onClick={() => setForm({ ...r, cities: r.cities.join(', ') })}>Edit</button>
        </div>
      ))}
    </section>
  );
}
