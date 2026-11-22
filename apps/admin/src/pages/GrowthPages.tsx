import { money } from '@ahia/shared';
import { BookOpenText, Download, Plug, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty } from '../ui';

const naira = (k: number | null) => (k == null ? '—' : money(Number(k)));
type Kind = 'TEMPLATE' | 'RECIPE' | 'INGREDIENT';

/** Edit planner templates, recipes and ingredients without a developer. */
export function PlannerContentPage() {
  const { busy, action, setError } = useAdmin();
  const [data, setData] = useState<any>(null);
  const [kind, setKind] = useState<Kind>('RECIPE');
  const [editing, setEditing] = useState<{ key: string; text: string; isNew: boolean } | null>(
    null,
  );
  const load = useCallback(
    () =>
      request('get', '/admin/planner/content')
        .then(setData)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => void load(), [load]);
  const rows: any[] = data
    ? { TEMPLATE: data.templates, RECIPE: data.recipes, INGREDIENT: data.ingredients }[kind]
    : [];
  const blank: Record<Kind, object> = {
    TEMPLATE: {
      key: 'new-plan',
      kind: 'CUSTOM',
      title: 'New plan type',
      description: '',
      questions: ['budget'],
      match: [],
      items: [],
    },
    RECIPE: {
      key: 'new-recipe',
      name: 'New recipe',
      description: '',
      time: 30,
      meals: ['DINNER'],
      per_serving: { rice: 0.15 },
      steps: ['Describe each step'],
    },
    INGREDIENT: {
      name: 'New ingredient',
      unit: 'kg',
      price: 1000,
      category: 'Food & groceries',
      keywords: '',
      allergens: [],
    },
  };
  const save = (key: string, body: { data?: unknown; active: boolean }, done: string) =>
    void action(async () => {
      await request('put', '/admin/planner/content/{type}/{key}', {
        params: { type: kind, key },
        body,
      });
      setEditing(null);
      await load();
    }, done);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>
            <BookOpenText size={18} /> Planner content
          </h2>
          <p>{data?.help}</p>
        </div>
        <div className="row-actions">
          {(['TEMPLATE', 'RECIPE', 'INGREDIENT'] as const).map((k) => (
            <button
              key={k}
              className={kind === k ? 'compact' : 'secondary compact'}
              onClick={() => {
                setKind(k);
                setEditing(null);
              }}
            >
              {{ TEMPLATE: 'Plan types', RECIPE: 'Recipes', INGREDIENT: 'Ingredients' }[k]}
            </button>
          ))}
          <button
            className="compact"
            onClick={() =>
              setEditing({
                key: (blank[kind] as any).key || 'new_ingredient',
                text: JSON.stringify(blank[kind], null, 2),
                isNew: true,
              })
            }
          >
            Add new
          </button>
        </div>
      </div>
      {editing && (
        <div className="settings-card">
          {editing.isNew && (
            <label>
              Key (lowercase, used in links and lists)
              <input
                value={editing.key}
                onChange={(e) => setEditing({ ...editing, key: e.target.value })}
              />
            </label>
          )}
          <label>
            {editing.isNew ? 'New' : 'Edit'} {kind.toLowerCase()} “{editing.key}”
            <textarea
              className="json-editor"
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
          </label>
          <div className="row-actions">
            <button
              disabled={busy}
              onClick={() => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(editing.text);
                } catch {
                  return setError('That isn’t valid JSON. Check commas and quotes.');
                }
                save(
                  editing.key,
                  { data: parsed, active: true },
                  'Saved. The app uses it within a minute.',
                );
              }}
            >
              Save
            </button>
            <button className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <b>{r.title}</b>
                  {kind === 'RECIPE' && (
                    <small>
                      {Object.keys(r.data.per_serving).length} ingredients · {r.data.time} min
                    </small>
                  )}
                  {kind === 'TEMPLATE' && <small>{r.data.items.length} items</small>}
                  {kind === 'INGREDIENT' && (
                    <small>
                      {naira(r.data.price * 100)} per {r.data.unit}
                      {r.data.allergens?.length ? ` · contains ${r.data.allergens.join(', ')}` : ''}
                    </small>
                  )}
                </td>
                <td>
                  <code>{r.key}</code>
                </td>
                <td>{r.custom ? <Badge status="ACTIVE" /> : <small>Built-in</small>}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="secondary compact"
                      onClick={() =>
                        setEditing({
                          key: r.key,
                          text: JSON.stringify(r.data, null, 2),
                          isNew: false,
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => save(r.key, { active: false }, 'Hidden from the app.')}
                    >
                      Hide
                    </button>
                    {r.custom && (
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await request('delete', '/admin/planner/content/{type}/{key}', {
                              params: { type: kind, key: r.key },
                            });
                            await load();
                          }, 'Back to the built-in version.')
                        }
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!data?.hidden?.length && (
        <div className="settings-card">
          <h3>Hidden</h3>
          {data.hidden.map((h: any) => (
            <p key={h.type + h.key}>
              {h.type.toLowerCase()} <code>{h.key}</code>{' '}
              <button
                className="text-button"
                onClick={() =>
                  void action(async () => {
                    await request('delete', '/admin/planner/content/{type}/{key}', {
                      params: { type: h.type, key: h.key },
                    });
                    await load();
                  }, 'Shown again.')
                }
              >
                Show again
              </button>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** Subscriptions and membership, market research reports and integration status. */
export function GrowthPage() {
  const { busy, action, setError } = useAdmin();
  const [plans, setPlans] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [state, setState] = useState('');
  const [integrations, setIntegrations] = useState<any>(null);
  const load = useCallback(() => {
    void request('get', '/admin/subscription-plans')
      .then(setPlans)
      .catch((e) => setError(e.message));
    void request('get', '/admin/subscriptions')
      .then(setSubs)
      .catch(() => {});
    void request('get', '/admin/integrations')
      .then(setIntegrations)
      .catch(() => {});
  }, [setError]);
  useEffect(load, [load]);
  useEffect(() => {
    void request('get', '/admin/market-reports', { query: state ? { state } : {} })
      .then(setReport)
      .catch(() => {});
  }, [state]);
  const csv = () => {
    if (!report) return;
    const lines = [
      [
        'Category',
        'Sellers',
        'Listings',
        'Median price (NGN)',
        'Orders 30d',
        'Sales 30d (NGN)',
        'Searches 30d',
      ],
      ...report.rows.map((r: any) => [
        r.category,
        r.sellers,
        r.listings,
        r.median_price_kobo == null ? 'hidden' : r.median_price_kobo / 100,
        r.orders_30_days ?? 'hidden',
        r.gmv_30_days_kobo == null ? 'hidden' : r.gmv_30_days_kobo / 100,
        r.searches_30_days,
      ]),
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([lines.map((l) => l.join(',')).join('\n')], { type: 'text/csv' }),
    );
    a.download = `ahia-market-report-${state || 'nigeria'}.csv`;
    a.click();
  };
  return (
    <>
      <section className="card">
        <h2>
          <Sparkles size={18} /> Plans and membership
        </h2>
        <p>
          Seller plans unlock insights, the assistant, bulk upload, team seats and API access. Ahia
          Plus is the buyer membership.
        </p>
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>For</th>
              <th>Price</th>
              <th>Includes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <small>{p.description}</small>
                </td>
                <td>{p.audience === 'SELLER' ? 'Sellers' : 'Buyers'}</td>
                <td>
                  {naira(p.price_kobo)}
                  <small>every {p.period_days} days</small>
                </td>
                <td>
                  <small>
                    {Object.entries(p.features)
                      .filter(([, v]) => v)
                      .map(([k, v]) =>
                        typeof v === 'number'
                          ? `${k.replaceAll('_', ' ')}: ${v}`
                          : k.replaceAll('_', ' '),
                      )
                      .join(' · ')}
                  </small>
                </td>
                <td>
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => {
                      const price = window.prompt(
                        `New price for ${p.name} (₦)`,
                        String(p.price_kobo / 100),
                      );
                      if (price)
                        void action(async () => {
                          await request('put', '/admin/subscription-plans/{id}', {
                            params: { id: p.id },
                            body: {
                              audience: p.audience,
                              name: p.name,
                              description: p.description,
                              price_kobo: Math.round(Number(price) * 100),
                              period_days: p.period_days,
                              features: p.features,
                              active: p.active,
                            },
                          });
                          load();
                        }, 'Price updated.');
                    }}
                  >
                    Change price
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Subscribers</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Plan</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.user_name}</b>
                    <small>{s.email}</small>
                  </td>
                  <td>
                    {s.plan_name}
                    <small>
                      {naira(s.fee_kobo)} · {s.payment_method}
                    </small>
                  </td>
                  <td>
                    <Badge status={s.status === 'PENDING_PAYMENT' ? 'PENDING' : s.status} />
                    {s.ends_at && <small>until {new Date(s.ends_at).toLocaleDateString()}</small>}
                  </td>
                  <td>
                    {s.status === 'PENDING_PAYMENT' && (
                      <button
                        className="compact"
                        disabled={busy}
                        onClick={() => {
                          const reference = window.prompt('Transfer reference for this payment');
                          if (reference)
                            void action(async () => {
                              await request('post', '/admin/subscriptions/{id}/activate', {
                                params: { id: s.id },
                                body: { reference },
                              });
                              load();
                            }, 'Membership activated and recorded as income.');
                        }}
                      >
                        Confirm payment
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!subs.length && (
          <Empty
            title="No subscribers yet"
            text="Sellers subscribe in the app’s Business hub; buyers join Ahia Plus from Account."
          />
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Market research report</h2>
            <p>{report?.note}</p>
          </div>
          <div className="row-actions">
            <input
              placeholder="State (empty = all Nigeria)"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
            <button className="secondary compact" onClick={csv}>
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Sellers</th>
                <th>Listings</th>
                <th>Median price</th>
                <th>Orders (30 days)</th>
                <th>Sales (30 days)</th>
                <th>Searches</th>
              </tr>
            </thead>
            <tbody>
              {report?.rows.map((r: any) => (
                <tr key={r.category}>
                  <td>
                    <b>{r.category}</b>
                    {r.suppressed && <small>Too few sellers to show figures</small>}
                  </td>
                  <td>{r.sellers}</td>
                  <td>{r.listings}</td>
                  <td>{naira(r.median_price_kobo)}</td>
                  <td>{r.orders_30_days ?? '—'}</td>
                  <td>{naira(r.gmv_30_days_kobo)}</td>
                  <td>{r.searches_30_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>
          <Plug size={18} /> Integrations
        </h2>
        <p>
          Plug-in points for third-party services. Each works today with a built-in default; connect
          a provider by adding an adapter (see apps/api/src/integrations/README.md) and setting its
          environment variable.
        </p>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Using</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {integrations?.providers.map((p: any) => (
              <tr key={p.kind}>
                <td>
                  <b>{p.kind.replace('_', ' ')}</b>
                </td>
                <td>
                  {p.provider}
                  <small>{p.connected ? 'Connected' : 'Built-in default'}</small>
                </td>
                <td>
                  <small>{p.purpose}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {integrations && (
          <p>
            Partner API: {integrations.partner_api.active_keys} active keys ·{' '}
            {integrations.partner_api.webhooks} webhooks ·{' '}
            {integrations.partner_api.failed_deliveries} failed deliveries
          </p>
        )}
      </section>
    </>
  );
}
