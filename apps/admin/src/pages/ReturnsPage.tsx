import { useEffect, useState } from 'react';
import { money } from '@zuru/shared';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
export default function ReturnsPage({ appeals = false }: { appeals?: boolean }) {
  const { action, busy, setError } = useAdmin();
  const [rows, setRows] = useState<any[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [form, setForm] = useState<any>({
      dispute_id: '',
      driver_id: '',
      pickup_address: '',
      pickup_latitude: '',
      pickup_longitude: '',
      fee_kobo: 50000,
      driver_kobo: 40000,
      payer: 'PLATFORM',
      reason: '',
    });
  const load = () =>
    appeals
      ? request('get', '/admin/appeals').then(setRows)
      : request('get', '/admin/returns').then(setRows);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [appeals]);
  return (
    <section className="card">
      <h2>{appeals ? 'Dispute appeals' : 'Reviewed return transport'}</h2>
      {!appeals && (
        <>
          <p>
            Development review only. Require a return in the dispute workspace first. Select a
            verified online rider and record the responsibility/evidence decision. The fee is held
            from the selected simulated payer; rider compensation settles only after both return
            PINs. Live liability and charges remain subject to approval.
          </p>
          {[
            ['dispute_id', 'Dispute case ID'],
            ['driver_id', 'Approved rider ID'],
            ['pickup_address', 'Buyer return collection address'],
            ['pickup_latitude', 'Collection latitude'],
            ['pickup_longitude', 'Collection longitude'],
            ['fee_kobo', 'Reviewed fee (kobo)'],
            ['driver_kobo', 'Rider compensation (kobo)'],
            ['reason', 'Reviewed reason and evidence'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={form[key]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [key]: ['fee_kobo', 'driver_kobo'].includes(key)
                      ? Number(e.target.value)
                      : e.target.value,
                  })
                }
              />
            </label>
          ))}
          <label>
            Reviewed payer
            <select
              value={form.payer}
              onChange={(e) => setForm({ ...form, payer: e.target.value })}
            >
              {['PLATFORM', 'SELLER', 'BUYER'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || form.reason.trim().length < 10}
            onClick={() =>
              void action(async () => {
                await request('post', '/admin/returns', {
                  body: {
                    ...form,
                    pickup_latitude: Number(form.pickup_latitude),
                    pickup_longitude: Number(form.pickup_longitude),
                  },
                });
                await load();
              }, 'Simulated return fee held and rider invited.')
            }
          >
            Arrange reviewed return
          </button>
        </>
      )}
      {rows.map((r) => (
        <div className="settings-card" key={r.id}>
          <h3>
            {r.title || r.dispute_id} · {r.status}
          </h3>
          <p>{r.reason}</p>
          {!appeals && (
            <>
              <p>Pickup: {r.pickup_address}</p>
              <p>Return to: {r.dropoff_address}</p>
              <p>
                Fee {money(r.fee_kobo)} · Rider {money(r.driver_kobo)} · Payer {r.payer_account}
              </p>
            </>
          )}
          {appeals && r.status === 'OPEN' && (
            <>
              <label>
                Reviewed outcome
                <textarea
                  value={notes[r.id] || ''}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                />
              </label>
              {(['UPHELD', 'DENIED'] as const).map((status) => (
                <button
                  key={status}
                  disabled={busy || (notes[r.id] || '').trim().length < 10}
                  onClick={() =>
                    void action(async () => {
                      await request('post', '/admin/appeals/{id}/review', {
                        params: { id: r.id },
                        body: { status, resolution: notes[r.id] },
                      });
                      await load();
                    }, 'Appeal outcome recorded. Financial adjustments require separate reviewed processing.')
                  }
                >
                  {status === 'UPHELD' ? 'Uphold appeal' : 'Decline appeal'}
                </button>
              ))}
            </>
          )}
          <p>{r.resolution}</p>
        </div>
      ))}
    </section>
  );
}
