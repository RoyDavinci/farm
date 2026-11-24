import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Empty } from '../ui';

/**
 * Promo codes (instant credit or cashback on the next completed order) and the referral reward
 * amounts. All rewards are Ahia credit paid from the marketing account; it can be spent at once
 * and withdrawn after the hold.
 */
export default function PromosPage() {
  const { busy, action, setError } = useAdmin();
  const [promos, setPromos] = useState<any[]>([]),
    [ref, setRef] = useState<any>(null),
    [kind, setKind] = useState<'CREDIT' | 'CASHBACK'>('CREDIT');
  const load = useCallback(() => {
    void request('get', '/admin/promo-codes')
      .then((r) => setPromos(r as any[]))
      .catch((e) => setError((e as Error).message));
    void request('get', '/admin/referrals')
      .then(setRef)
      .catch((e) => setError((e as Error).message));
  }, [setError]);
  useEffect(load, [load]);
  const kobo = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
  return (
    <div className="settings-grid">
      <section className="card settings-card">
        <h2>New promo code</h2>
        <p>
          Credit is added to the wallet as soon as the code is entered. Cashback is paid when the
          customer’s next order completes. Each person can use a code once.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const ends = String(f.get('ends') || '');
            void action(async () => {
              await request('post', '/admin/promo-codes', {
                body: {
                  code: String(f.get('code')),
                  kind,
                  amount_kobo: kind === 'CREDIT' ? kobo(f.get('amount')) : 0,
                  percent: kind === 'CASHBACK' ? Number(f.get('percent')) : 0,
                  max_kobo: kind === 'CASHBACK' ? kobo(f.get('max')) : 0,
                  min_order_kobo: kobo(f.get('minOrder')),
                  max_uses: f.get('uses') ? Number(f.get('uses')) : null,
                  new_customers_only: f.get('newOnly') === 'on',
                  ends_at: ends ? new Date(`${ends}T23:59:00`).toISOString() : null,
                  note: String(f.get('note') || '') || undefined,
                },
              });
              form.reset();
              load();
            }, 'Promo code created.');
          }}
        >
          <label>
            Code (letters and numbers)
            <input name="code" required pattern="[A-Za-z0-9]{3,20}" placeholder="e.g. WELCOME500" />
          </label>
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="CREDIT">Instant credit (fixed ₦)</option>
              <option value="CASHBACK">Cashback on next completed order (%)</option>
            </select>
          </label>
          {kind === 'CREDIT' ? (
            <label>
              Credit (₦)
              <input name="amount" type="number" min="1" step="1" required placeholder="500" />
            </label>
          ) : (
            <>
              <label>
                Cashback (%)
                <input name="percent" type="number" min="1" max="100" required placeholder="10" />
              </label>
              <label>
                Most cashback per person (₦, 0 = no cap)
                <input name="max" type="number" min="0" step="1" defaultValue={1000} />
              </label>
            </>
          )}
          <label>
            Smallest order it applies to (₦)
            <input name="minOrder" type="number" min="0" step="1" defaultValue={0} />
          </label>
          <label>
            Total uses allowed (empty = no limit)
            <input name="uses" type="number" min="1" step="1" />
          </label>
          <label>
            Ends on (optional)
            <input name="ends" type="date" />
          </label>
          <label>
            Note for staff (optional)
            <input name="note" maxLength={200} placeholder="e.g. Instagram campaign, Nov" />
          </label>
          <label className="check">
            <input name="newOnly" type="checkbox" /> New customers only (no completed order yet)
          </label>
          <button disabled={busy}>Create promo code</button>
        </form>
      </section>

      {ref && (
        <section className="card settings-card">
          <h2>Referral rewards</h2>
          <p>
            {ref.totals.invited} people joined with a link · {ref.totals.rewarded} rewarded · paid{' '}
            {money(ref.totals.referral_paid_kobo)} in referral rewards and{' '}
            {money(ref.totals.promo_paid_kobo)} in promo credit.
          </p>
          <form
            key={JSON.stringify(ref.settings)}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                await request('put', '/admin/referrals', {
                  body: {
                    referral_reward_kobo: kobo(f.get('reward')),
                    referral_welcome_kobo: kobo(f.get('welcome')),
                    referral_min_order_kobo: kobo(f.get('minOrder')),
                    credit_hold_days: Number(f.get('hold')),
                  },
                });
                load();
              }, 'Referral rewards saved.');
            }}
          >
            <label>
              The person who invites gets (₦)
              <input
                name="reward"
                type="number"
                min="0"
                defaultValue={ref.settings.referral_reward_kobo / 100}
              />
            </label>
            <label>
              The new customer gets (₦)
              <input
                name="welcome"
                type="number"
                min="0"
                defaultValue={ref.settings.referral_welcome_kobo / 100}
              />
            </label>
            <label>
              Their first order must be at least (₦)
              <input
                name="minOrder"
                type="number"
                min="0"
                defaultValue={ref.settings.referral_min_order_kobo / 100}
              />
            </label>
            <label>
              Days before reward credit can be withdrawn or sent
              <input
                name="hold"
                type="number"
                min="0"
                max="365"
                defaultValue={ref.settings.credit_hold_days}
              />
            </label>
            <button disabled={busy}>Save referral rewards</button>
          </form>
          {!!ref.top.length && (
            <table>
              <thead>
                <tr>
                  <th>Top inviters</th>
                  <th>Joined</th>
                  <th>Rewarded</th>
                </tr>
              </thead>
              <tbody>
                {ref.top.map((t: any) => (
                  <tr key={t.ahia_id}>
                    <td>
                      <b>{t.name}</b>
                      <small>{t.ahia_id}</small>
                    </td>
                    <td>{t.invited}</td>
                    <td>{t.rewarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Promo codes</h2>
        {!promos.length ? (
          <Empty title="No promo codes yet" text="Create one with the form." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Gives</th>
                  <th>Rules</th>
                  <th>Used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.code}</b>
                      <small>{p.note || (p.active ? 'Active' : 'Switched off')}</small>
                    </td>
                    <td>
                      {p.kind === 'CREDIT'
                        ? `${money(p.amount_kobo)} credit`
                        : `${p.percent}% back${p.max_kobo ? ` (max ${money(p.max_kobo)})` : ''}`}
                    </td>
                    <td>
                      <small>
                        {[
                          p.min_order_kobo ? `orders ${money(p.min_order_kobo)}+` : '',
                          p.new_customers_only ? 'new customers' : '',
                          p.ends_at ? `until ${new Date(p.ends_at).toLocaleDateString()}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Anyone'}
                      </small>
                    </td>
                    <td>
                      {p.uses}
                      {p.max_uses ? ` / ${p.max_uses}` : ''}
                      <small>{money(p.paid_kobo)} paid</small>
                    </td>
                    <td>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            async () => {
                              await request('post', '/admin/promo-codes/{id}/active', {
                                params: { id: p.id },
                                body: { active: !p.active },
                              });
                              load();
                            },
                            p.active ? 'Promo code switched off.' : 'Promo code switched on.',
                          )
                        }
                      >
                        {p.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
