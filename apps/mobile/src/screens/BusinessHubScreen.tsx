import { money } from '@ahia/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { actAsSeller } from '../api';
import { useApp } from '../AppContext';
import DirectPay from '../DirectPay';
import { VerifiedBadge } from '../BusinessTools';
import { request } from '../request';
import { FadeIn } from '../ui';

const BRAND = '#1f754a',
  ACCENT = '#f5a524',
  INK = '#143022',
  MUTED = '#587667';
const naira = (k: number) => money(Number(k || 0));
const toKobo = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, '') || 0) * 100);

/**
 * Business hub: seller plans, the listing assistant, business report, market insights, bulk
 * requests (B2B), team, bulk upload and connections to the seller's own systems.
 */
export default function BusinessHubScreen() {
  const { seller } = useApp();
  const isSeller = seller?.status === 'APPROVED';
  const [subs, setSubs] = useState<any>(null);
  const loadSubs = useCallback(
    () =>
      request('get', '/me/subscriptions')
        .then(setSubs)
        .catch(() => {}),
    [],
  );
  useEffect(() => void loadSubs(), [loadSubs]);
  const f = subs?.seller_features || {};
  return (
    <View style={{ gap: 14 }}>
      <View>
        <Text style={styles.title}>Business hub</Text>
        <Text style={styles.sub}>
          Tools to grow: insights, bulk buying and selling, and connections.
        </Text>
      </View>
      {isSeller && (
        <Section title="Your seller plan" open>
          <SellerPlans subs={subs} onChanged={loadSubs} />
        </Section>
      )}
      {isSeller && (
        <Section title="✨ Listing assistant" locked={!f.ai_assistant}>
          <ListingAssistant />
        </Section>
      )}
      {isSeller && (
        <Section title="📈 Business report" locked={!f.business_report}>
          <BusinessReport />
        </Section>
      )}
      {isSeller && (
        <Section title="📊 Market insights" locked={!f.insights}>
          <MarketInsights />
        </Section>
      )}
      <Section title="📦 Bulk requests (B2B)">
        <BulkRequests isSeller={isSeller} />
      </Section>
      {isSeller && (
        <Section title="👥 Team" locked={!f.team_seats}>
          <Team />
        </Section>
      )}
      {isSeller && (
        <Section title="⬆️ Bulk upload" locked={!f.bulk_import}>
          <BulkUpload />
        </Section>
      )}
      {isSeller && (
        <Section title="🔌 Connect your systems" locked={!f.api_access}>
          <Connections />
        </Section>
      )}
    </View>
  );
}

function Section({
  title,
  children,
  open = false,
  locked = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  locked?: boolean;
}) {
  const [shown, setShown] = useState(open);
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" onPress={() => setShown(!shown)} style={styles.head}>
        <Text style={styles.headText}>{title}</Text>
        {locked && <Text style={styles.lock}>Pro</Text>}
        <Text style={styles.chev}>{shown ? '⌃' : '⌄'}</Text>
      </Pressable>
      {shown &&
        (locked ? (
          <Text style={styles.meta}>
            Part of the Seller Pro and Business plans. Choose a plan above to unlock it.
          </Text>
        ) : (
          <FadeIn style={{ gap: 10 }}>{children}</FadeIn>
        ))}
    </View>
  );
}

function SellerPlans({ subs, onChanged }: { subs: any; onChanged: () => void }) {
  const { run, busy } = useApp();
  const [plans, setPlans] = useState<any[]>([]);
  useEffect(() => {
    void request('get', '/subscription-plans', { query: { audience: 'SELLER' } })
      .then(setPlans)
      .catch(() => {});
  }, []);
  const current = subs?.subscriptions?.find(
    (s: any) => s.audience === 'SELLER' && s.status === 'ACTIVE',
  );
  const waiting = subs?.subscriptions?.find(
    (s: any) => s.audience === 'SELLER' && s.status === 'PENDING_PAYMENT',
  );
  const choose = (p: any, pay_with: 'proceeds' | 'card') =>
    void run(
      async () => {
        await request('post', '/me/subscriptions', { body: { plan_id: p.id, pay_with } });
        onChanged();
      },
      pay_with === 'proceeds' ? `${p.name} is active. Paid from your sales proceeds.` : '',
    );
  return (
    <>
      {waiting && !current && <PayPlanByCard sub={waiting} onPaid={onChanged} />}
      {current ? (
        <Text style={styles.good}>
          {current.name} is active until {new Date(current.ends_at).toLocaleDateString()}.
        </Text>
      ) : (
        <Text style={styles.meta}>
          You are on the free plan. Selling and basic tools stay free.
        </Text>
      )}
      {plans.map((p) => (
        <View key={p.id} style={styles.plan}>
          <Text style={styles.planName}>
            {p.name} · {naira(p.price_kobo)} / {p.period_days} days
          </Text>
          <Text style={styles.meta}>{p.description}</Text>
          {current?.plan_id === p.id ? (
            <Small
              label="Cancel plan"
              danger
              onPress={() =>
                void run(async () => {
                  await request('post', '/me/subscriptions/{id}/cancel', {
                    params: { id: current.id },
                  });
                  onChanged();
                }, 'Plan cancelled.')
              }
            />
          ) : (
            !current && (
              <View style={styles.rowWrap}>
                <Small
                  label="Pay by card"
                  primary
                  disabled={busy}
                  onPress={() => choose(p, 'card')}
                />
                <Small
                  label="Pay from proceeds"
                  disabled={busy}
                  onPress={() => choose(p, 'proceeds')}
                />
              </View>
            )
          )}
        </View>
      ))}
    </>
  );
}

function ListingAssistant() {
  const { run, busy, settings } = useApp();
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: settings?.catalog?.categories?.[0] || 'Other',
    unit: 'piece',
    price: '',
  });
  const [out, setOut] = useState<any>(null);
  return (
    <>
      <Input
        value={form.title}
        onChange={(v) => setForm({ ...form, title: v })}
        placeholder="Product title"
      />
      <Input
        value={form.description}
        onChange={(v) => setForm({ ...form, description: v })}
        placeholder="Description (optional)"
        multiline
      />
      <Chips
        options={settings?.catalog?.categories || []}
        value={form.category}
        onChange={(v) => setForm({ ...form, category: v })}
      />
      <View style={styles.row}>
        <Input
          value={form.unit}
          onChange={(v) => setForm({ ...form, unit: v })}
          placeholder="Unit"
          flex
        />
        <Input
          value={form.price}
          onChange={(v) => setForm({ ...form, price: v })}
          placeholder="Price ₦"
          flex
          numeric
        />
      </View>
      <Small
        label="Suggest improvements"
        primary
        disabled={busy || form.title.trim().length < 2}
        onPress={() =>
          void run(async () =>
            setOut(
              await request('post', '/sellers/me/ai/listing-assist', {
                body: {
                  title: form.title,
                  description: form.description,
                  category: form.category,
                  unit: form.unit,
                  ...(form.price ? { price_kobo: toKobo(form.price) } : {}),
                },
              }),
            ),
          )
        }
      />
      {out && (
        <View style={styles.result}>
          <Text style={styles.label}>Suggested title</Text>
          <Text style={styles.value}>{out.title}</Text>
          <Text style={styles.label}>Suggested description</Text>
          <Text style={styles.meta}>{out.description}</Text>
          {out.price && (
            <Text style={styles.meta}>
              Similar listings: {naira(out.price.low_kobo)} – {naira(out.price.high_kobo)} (typical{' '}
              {naira(out.price.median_kobo)}, {out.price.sellers} sellers)
            </Text>
          )}
          {out.tips.map((t: string) => (
            <Text key={t} style={styles.meta}>
              • {t}
            </Text>
          ))}
          <Text style={styles.fine}>
            {out.source === 'rules'
              ? 'Suggestions from Ahia’s listing guide.'
              : `Written with ${out.source}. Check before using.`}
          </Text>
        </View>
      )}
    </>
  );
}

function BusinessReport() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    void request('get', '/sellers/me/business-report', { query: { days: 30 } })
      .then(setData)
      .catch(() => {});
  }, []);
  if (!data) return <Text style={styles.meta}>Loading…</Text>;
  return (
    <>
      <View style={styles.stats}>
        <Stat label="Orders" value={String(data.sales.completed)} />
        <Stat label="Sales" value={naira(data.sales.gross_kobo)} />
        <Stat label="You earned" value={naira(data.sales.net_kobo)} />
      </View>
      <Text style={styles.meta}>
        Last {data.days} days · {data.sales.requests} requests · {data.sales.lost} declined or
        expired
      </Text>
      {!!data.top_products.length && <Text style={styles.label}>Best sellers</Text>}
      {data.top_products.map((t: any) => (
        <Text key={t.id} style={styles.meta}>
          {t.title} · {t.orders} orders · {naira(t.gross_kobo)}
        </Text>
      ))}
      <Text style={styles.label}>What to do next</Text>
      {data.actions.map((a: string) => (
        <Text key={a} style={styles.meta}>
          • {a}
        </Text>
      ))}
    </>
  );
}

function MarketInsights() {
  const { settings } = useApp();
  const [category, setCategory] = useState(settings?.catalog?.categories?.[0] || 'Other');
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    void request('get', '/sellers/me/market-insights', { query: { category } })
      .then(setData)
      .catch(() => setData(null));
  }, [category]);
  return (
    <>
      <Chips
        options={settings?.catalog?.categories || []}
        value={category}
        onChange={setCategory}
      />
      {data && (
        <View style={styles.result}>
          <Text style={styles.value}>
            {data.category} · {data.state}
          </Text>
          <Text style={styles.meta}>
            {data.sellers} sellers · {data.listings} listings
          </Text>
          {data.price && (
            <Text style={styles.meta}>
              Typical price {naira(data.price.median_kobo)} (most between{' '}
              {naira(data.price.p25_kobo)} and {naira(data.price.p75_kobo)})
            </Text>
          )}
          {data.demand && (
            <Text style={styles.meta}>
              {data.demand.orders_30_days} orders and {data.demand.searches_30_days} searches in 30
              days
              {data.demand.change_percent != null
                ? ` · ${data.demand.change_percent > 0 ? '+' : ''}${data.demand.change_percent}% vs before`
                : ''}
            </Text>
          )}
          {data.popular?.map((p: any) => (
            <Text key={p.title} style={styles.meta}>
              Popular: {p.title}
            </Text>
          ))}
          <Text style={styles.fine}>{data.note}</Text>
        </View>
      )}
    </>
  );
}

function BulkRequests({ isSeller }: { isSeller: boolean }) {
  const { run, busy, settings } = useApp();
  const [mine, setMine] = useState<any[]>([]);
  const [open, setOpen] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState({
    business_name: '',
    title: '',
    category: settings?.catalog?.categories?.[0] || 'Other',
    quantity: '',
    unit: 'bag',
    details: '',
    budget: '',
  });
  const [quoting, setQuoting] = useState<string | null>(null);
  const [quote, setQuote] = useState({ total: '', days: '2', note: '' });
  const load = useCallback(() => {
    void request('get', '/rfqs/mine')
      .then(setMine)
      .catch(() => {});
    if (isSeller)
      void request('get', '/rfqs/open')
        .then(setOpen)
        .catch(() => {});
  }, [isSeller]);
  useEffect(load, [load]);
  return (
    <>
      <Text style={styles.meta}>
        Buying in bulk for a shop, restaurant or event? Ask several sellers for a price at once.
      </Text>
      <Input
        value={form.business_name}
        onChange={(v) => setForm({ ...form, business_name: v })}
        placeholder="Your business name (optional)"
      />
      <Input
        value={form.title}
        onChange={(v) => setForm({ ...form, title: v })}
        placeholder="What do you need? e.g. Tomatoes for our restaurant"
      />
      <Chips
        options={settings?.catalog?.categories || []}
        value={form.category}
        onChange={(v) => setForm({ ...form, category: v })}
      />
      <View style={styles.row}>
        <Input
          value={form.quantity}
          onChange={(v) => setForm({ ...form, quantity: v })}
          placeholder="Quantity"
          flex
          numeric
        />
        <Input
          value={form.unit}
          onChange={(v) => setForm({ ...form, unit: v })}
          placeholder="Unit"
          flex
        />
        <Input
          value={form.budget}
          onChange={(v) => setForm({ ...form, budget: v })}
          placeholder="Budget ₦"
          flex
          numeric
        />
      </View>
      <Input
        value={form.details}
        onChange={(v) => setForm({ ...form, details: v })}
        placeholder="Details: quality, delivery, how often"
        multiline
      />
      <Small
        label="Ask for quotes"
        primary
        disabled={busy || form.title.trim().length < 3 || !Number(form.quantity)}
        onPress={() =>
          void run(async () => {
            await request('post', '/rfqs', {
              body: {
                business_name: form.business_name,
                title: form.title,
                category: form.category,
                quantity: Number(form.quantity),
                unit: form.unit || 'piece',
                details: form.details,
                ...(form.budget ? { budget_kobo: toKobo(form.budget) } : {}),
              },
            });
            setForm({ ...form, title: '', quantity: '', details: '', budget: '' });
            load();
          }, 'Request sent. Sellers will reply with quotes.')
        }
      />
      {!!mine.length && <Text style={styles.label}>Your requests</Text>}
      {mine.map((r) => (
        <Pressable
          key={r.id}
          onPress={() =>
            void request('get', '/rfqs/{id}', { params: { id: r.id } }).then(setDetail)
          }
          style={styles.item}
        >
          <Text style={styles.value}>{r.title}</Text>
          <Text style={styles.meta}>
            {r.quantity} {r.unit} · {r.status.toLowerCase()} · {r.quotes} quote
            {r.quotes === 1 ? '' : 's'}
          </Text>
        </Pressable>
      ))}
      {detail && (
        <View style={styles.result}>
          <Text style={styles.value}>Quotes for {detail.title}</Text>
          {!detail.quotes.length && <Text style={styles.meta}>No quotes yet.</Text>}
          {detail.quotes.map((q: any) => (
            <View key={q.id} style={styles.item}>
              <View style={styles.row}>
                <Text style={styles.value}>{q.business_name}</Text>
                {q.verified && <VerifiedBadge small />}
              </View>
              <Text style={styles.meta}>
                {naira(q.total_kobo)} · ready in {q.delivery_days} day
                {q.delivery_days === 1 ? '' : 's'} · {q.status.toLowerCase()}
              </Text>
              {!!q.note && <Text style={styles.meta}>{q.note}</Text>}
              {detail.status === 'OPEN' && (
                <Small
                  label="Accept this quote"
                  primary
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/rfqs/{id}/quotes/{quoteId}/accept', {
                        params: { id: detail.id, quoteId: q.id },
                      });
                      setDetail(null);
                      load();
                    }, 'Quote accepted. The seller has been told.')
                  }
                />
              )}
            </View>
          ))}
        </View>
      )}
      {isSeller && <Text style={styles.label}>Requests you can quote on</Text>}
      {isSeller && !open.length && <Text style={styles.meta}>No open requests right now.</Text>}
      {open.map((r) => (
        <View key={r.id} style={styles.item}>
          <Text style={styles.value}>
            {r.title} {r.matches_my_shop ? '· matches your shop' : ''}
          </Text>
          <Text style={styles.meta}>
            {r.business_name || 'A buyer'} · {r.quantity} {r.unit} · {r.category}
            {r.budget_kobo ? ` · budget ${naira(r.budget_kobo)}` : ''}
          </Text>
          {!!r.details && <Text style={styles.meta}>{r.details}</Text>}
          {r.my_quote ? (
            <Text style={styles.good}>You quoted {naira(r.my_quote.total_kobo)}.</Text>
          ) : quoting === r.id ? (
            <>
              <View style={styles.row}>
                <Input
                  value={quote.total}
                  onChange={(v) => setQuote({ ...quote, total: v })}
                  placeholder="Total ₦"
                  flex
                  numeric
                />
                <Input
                  value={quote.days}
                  onChange={(v) => setQuote({ ...quote, days: v })}
                  placeholder="Days"
                  flex
                  numeric
                />
              </View>
              <Input
                value={quote.note}
                onChange={(v) => setQuote({ ...quote, note: v })}
                placeholder="Note to the buyer"
              />
              <Small
                label="Send quote"
                primary
                disabled={busy || !toKobo(quote.total)}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/rfqs/{id}/quotes', {
                      params: { id: r.id },
                      body: {
                        total_kobo: toKobo(quote.total),
                        delivery_days: Number(quote.days) || 0,
                        note: quote.note,
                      },
                    });
                    setQuoting(null);
                    load();
                  }, 'Quote sent.')
                }
              />
            </>
          ) : (
            <Small label="Send a quote" onPress={() => setQuoting(r.id)} />
          )}
        </View>
      ))}
    </>
  );
}

function Team() {
  const { run, busy } = useApp();
  const [team, setTeam] = useState<any>(null);
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<'STAFF' | 'MANAGER'>('STAFF');
  const load = () =>
    void request('get', '/sellers/me/team')
      .then(setTeam)
      .catch(() => {});
  useEffect(load, []);
  return (
    <>
      <Text style={styles.meta}>
        {team ? `${team.members.length} of ${team.seats} seats used. ${team.note}` : 'Loading…'}
      </Text>
      {team?.members.map((m: any) => (
        <View key={m.user_id} style={styles.rowBetween}>
          <Text style={styles.value}>
            {m.name} · {m.role.toLowerCase()}
          </Text>
          <Small
            label="Remove"
            danger
            onPress={() =>
              void run(async () => {
                await request('delete', '/sellers/me/team/{userId}', {
                  params: { userId: m.user_id },
                });
                load();
              })
            }
          />
        </View>
      ))}
      <View style={styles.rowWrap}>
        {(['STAFF', 'MANAGER'] as const).map((r) => (
          <Small
            key={r}
            label={r === 'STAFF' ? 'Staff' : 'Manager'}
            primary={role === r}
            onPress={() => setRole(r)}
          />
        ))}
      </View>
      <Input value={contact} onChange={setContact} placeholder="Team member’s email or phone" />
      <Small
        label="Add to team"
        primary
        disabled={busy || contact.trim().length < 5}
        onPress={() =>
          void run(async () => {
            await request('post', '/sellers/me/team', {
              body: { contact: contact.trim(), role },
            });
            setContact('');
            load();
          }, 'Added to your team. They can switch to your shop from their Account screen.')
        }
      />
      {!!team?.activity?.length && (
        <>
          <Text style={[styles.meta, { marginTop: 8, fontWeight: '700' }]}>
            Recent team activity
          </Text>
          {team.activity.slice(0, 12).map((a: any) => (
            <Text key={a.id} style={styles.meta}>
              {new Date(a.created_at).toLocaleString()} · {a.member_name} · {describeAction(a)}
              {a.status >= 400 ? ' (refused)' : ''}
            </Text>
          ))}
        </>
      )}
    </>
  );
}

const ORDER_ACTIONS: Record<string, string> = {
  accept: 'accepted',
  decline: 'declined',
  counter: 'countered',
  ready: 'marked ready',
  pickup: 'handed over',
  cancel: 'cancelled',
  dispute: 'disputed',
};
/** Plain words for a team member's change, from the request they made. */
function describeAction(a: { method: string; path: string }) {
  const p = a.path;
  if (/^\/listings$/.test(p) && a.method === 'POST') return 'added a product';
  if (/^\/listings\//.test(p))
    return a.method === 'DELETE' ? 'removed a product' : 'updated a product';
  const order = p.match(/^\/bookings\/[^/]+\/([a-z-]+)$/);
  if (order) return `${ORDER_ACTIONS[order[1]] || order[1].replace('-', ' ')} an order`;
  if (p.startsWith('/conversations')) return 'replied in chat';
  if (p.startsWith('/local-status')) return 'posted a story';
  if (p.startsWith('/media')) return 'uploaded a photo';
  if (p.startsWith('/rfqs')) return 'sent a bulk quote';
  return `${a.method} ${p}`;
}

/** Finish paying for a plan by card (Paystack or Flutterwave checkout). */
function PayPlanByCard({ sub, onPaid }: { sub: any; onPaid: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.meta}>
        {sub.name} starts as soon as your card payment of {naira(sub.fee_kobo)} goes through.
      </Text>
      <DirectPay
        amountKobo={sub.fee_kobo}
        checkout={{ purpose: 'subscription', subscription_id: sub.id }}
        onPaid={async () => onPaid()}
        paidMessage={`${sub.name} is active. Thank you!`}
      />
    </View>
  );
}

/** Shops this person is on the team of, to switch into from the Account screen. */
export function MyTeams() {
  const { me, run, setTab } = useApp();
  const [teams, setTeams] = useState<any[]>([]);
  useEffect(() => {
    if (me?.acting_member) return;
    void request('get', '/me/teams')
      .then(setTeams)
      .catch(() => {});
  }, [me?.id, me?.acting_member]);
  if (me?.acting_member || !teams.length) return null;
  return (
    <View style={styles.member}>
      <Text style={styles.memberTitle}>🏪 Shops you work for</Text>
      {teams.map((t) => (
        <View key={t.seller_id} style={styles.rowBetween}>
          <Text style={styles.memberText}>
            {t.business_name} · {t.area} · {t.role === 'MANAGER' ? 'manager' : 'staff'}
          </Text>
          <Small
            label="Work for this shop"
            primary
            onPress={() =>
              void run(async () => {
                await actAsSeller(t.seller_id);
                setTab('Sell');
              }, `You’re now working for ${t.business_name}.`)
            }
          />
        </View>
      ))}
    </View>
  );
}

function BulkUpload() {
  const { run, busy } = useApp();
  const [text, setText] = useState('');
  const rows = text
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .filter((r) => r.length >= 5 && r[0]);
  return (
    <>
      <Text style={styles.meta}>
        One product per line: title, category, unit, price in ₦, stock, description
      </Text>
      <Input
        value={text}
        onChange={setText}
        placeholder={'Green peppers, Vegetables, kg, 1500, 20, Fresh from Jos'}
        multiline
      />
      <Small
        label={`Upload ${rows.length} product${rows.length === 1 ? '' : 's'}`}
        primary
        disabled={busy || !rows.length}
        onPress={() =>
          void run(async () => {
            const r = await request('post', '/sellers/me/listings/import', {
              body: {
                items: rows.map(([title, category, unit, price, stock, ...desc]) => ({
                  title,
                  category,
                  unit,
                  price_kobo: toKobo(price),
                  stock: Number(stock) || 0,
                  description: desc.join(', ') || title,
                })),
              },
            });
            setText('');
            return r;
          }, 'Products uploaded. They appear under Sell.')
        }
      />
    </>
  );
}

function Connections() {
  const { run, busy } = useApp();
  const [data, setData] = useState<any>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const load = () =>
    void request('get', '/sellers/me/integrations')
      .then(setData)
      .catch(() => {});
  useEffect(load, []);
  return (
    <>
      <Text style={styles.meta}>
        Connect your inventory, POS or accounting software. {data?.docs}
      </Text>
      {secret && (
        <View style={styles.secret}>
          <Text style={styles.label}>Copy this now — it won’t be shown again</Text>
          <Text selectable style={styles.code}>
            {secret}
          </Text>
        </View>
      )}
      <Text style={styles.label}>API keys</Text>
      {data?.keys.map((k: any) => (
        <View key={k.id} style={styles.rowBetween}>
          <Text style={styles.meta}>
            {k.name} · {k.key_prefix}… {k.revoked_at ? '· revoked' : ''}
          </Text>
          {!k.revoked_at && (
            <Small
              label="Revoke"
              danger
              onPress={() =>
                void run(async () => {
                  await request('delete', '/sellers/me/api-keys/{id}', { params: { id: k.id } });
                  load();
                })
              }
            />
          )}
        </View>
      ))}
      <Input value={name} onChange={setName} placeholder="Key name, e.g. Shop POS" />
      <Small
        label="Create API key"
        primary
        disabled={busy || name.trim().length < 2}
        onPress={() =>
          void run(async () => {
            const r = await request('post', '/sellers/me/api-keys', {
              body: {
                name: name.trim(),
                scopes: ['listings:read', 'listings:write', 'orders:read'],
              },
            });
            setSecret(r.key);
            setName('');
            load();
          })
        }
      />
      <Text style={styles.label}>Webhooks (order updates)</Text>
      {data?.webhooks.map((w: any) => (
        <View key={w.id} style={styles.rowBetween}>
          <Text style={[styles.meta, { flex: 1 }]} numberOfLines={1}>
            {w.url}
          </Text>
          <Small
            label="Delete"
            danger
            onPress={() =>
              void run(async () => {
                await request('delete', '/sellers/me/webhooks/{id}', { params: { id: w.id } });
                load();
              })
            }
          />
        </View>
      ))}
      <Input value={url} onChange={setUrl} placeholder="https://your-system.example/ahia" />
      <Small
        label="Add webhook"
        disabled={busy || !url.startsWith('https://')}
        onPress={() =>
          void run(async () => {
            const r = await request('post', '/sellers/me/webhooks', {
              body: { url: url.trim(), events: ['order.created', 'order.status_changed'] },
            });
            setSecret(r.secret);
            setUrl('');
            load();
          })
        }
      />
    </>
  );
}

/** Buyer membership card (Ahia Plus), shown on the Account screen. */
export function MembershipCard() {
  const { run, busy, settings } = useApp();
  const card = !!settings?.providers?.length;
  const [plans, setPlans] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const load = () => {
    void request('get', '/subscription-plans', { query: { audience: 'BUYER' } })
      .then(setPlans)
      .catch(() => {});
    void request('get', '/me/subscriptions')
      .then((s) => setSubs(s.subscriptions))
      .catch(() => {});
  };
  useEffect(load, []);
  if (!plans.length) return null;
  const mine = subs.find(
    (s) => s.audience === 'BUYER' && ['ACTIVE', 'PENDING_PAYMENT'].includes(s.status),
  );
  return (
    <View style={styles.member}>
      <Text style={styles.memberTitle}>⭐ {plans[0].name}</Text>
      <Text style={styles.memberText}>{plans[0].description}</Text>
      {mine ? (
        <Text style={styles.memberText}>
          {mine.status === 'ACTIVE'
            ? `Active until ${new Date(mine.ends_at).toLocaleDateString()}.`
            : mine.payment_method === 'card'
              ? ''
              : 'Waiting for Ahia to confirm your transfer.'}
        </Text>
      ) : null}
      {mine?.status === 'PENDING_PAYMENT' && mine.payment_method === 'card' ? (
        <PayPlanByCard sub={mine} onPaid={load} />
      ) : mine ? null : (
        <Small
          label={`Join for ${naira(plans[0].price_kobo)} / ${plans[0].period_days} days`}
          primary
          disabled={busy}
          onPress={() =>
            void run(
              async () => {
                const r = await request('post', '/me/subscriptions', {
                  body: { plan_id: plans[0].id, pay_with: card ? 'card' : 'transfer' },
                });
                load();
                return r;
              },
              card ? '' : 'Request received. Ahia will confirm your membership.',
            )
          }
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------- small pieces
function Input({
  value,
  onChange,
  placeholder,
  multiline,
  flex,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
  flex?: boolean;
  numeric?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#8aa698"
      multiline={multiline}
      keyboardType={numeric ? 'numeric' : 'default'}
      accessibilityLabel={placeholder}
      style={[
        styles.input,
        multiline && { minHeight: 80, textAlignVertical: 'top' },
        flex && { flex: 1 },
      ]}
    />
  );
}
function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.slice(0, 18).map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.chip, value === o && styles.chipOn]}
        >
          <Text style={[styles.chipText, value === o && { color: '#fff' }]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function Small({
  label,
  onPress,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.small,
        primary && { backgroundColor: BRAND },
        danger && { backgroundColor: '#fbecea' },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[styles.smallText, primary && { color: '#fff' }, danger && { color: '#a33e32' }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: MUTED, marginTop: 2 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2f0e9',
    padding: 14,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headText: { flex: 1, fontSize: 16, fontWeight: '800', color: INK },
  lock: {
    fontSize: 10,
    fontWeight: '900',
    color: '#3b2600',
    backgroundColor: ACCENT,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  chev: { fontSize: 16, color: '#9ab5a8' },
  meta: { fontSize: 13, color: MUTED, lineHeight: 19 },
  fine: { fontSize: 11, color: '#8aa698', lineHeight: 16 },
  good: { fontSize: 13, fontWeight: '700', color: '#1f7a45' },
  label: { fontSize: 12, fontWeight: '800', color: '#325142', marginTop: 4 },
  value: { fontSize: 14, fontWeight: '700', color: INK },
  plan: { borderRadius: 14, backgroundColor: '#f6fbf8', padding: 12, gap: 6 },
  planName: { fontSize: 15, fontWeight: '800', color: INK },
  input: {
    borderWidth: 1,
    borderColor: '#d4e8de',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 11,
    fontSize: 14,
    color: INK,
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d4e8de',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 12, fontWeight: '600', color: '#305c46' },
  small: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#eef8f3',
  },
  smallText: { fontSize: 13, fontWeight: '700', color: BRAND },
  result: { backgroundColor: '#f4fbf8', borderRadius: 14, padding: 12, gap: 6 },
  item: { borderTopWidth: 1, borderTopColor: '#eef5f2', paddingTop: 10, gap: 4 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: '#f4fbf8', borderRadius: 12, padding: 10 },
  statLabel: { fontSize: 11, color: MUTED, fontWeight: '600' },
  statValue: { fontSize: 15, color: INK, fontWeight: '800', marginTop: 2 },
  secret: { backgroundColor: '#fff4e0', borderRadius: 12, padding: 10, gap: 4 },
  code: { fontFamily: 'Courier', fontSize: 12, color: INK },
  member: { backgroundColor: BRAND, borderRadius: 18, padding: 16, gap: 8 },
  memberTitle: { fontSize: 17, fontWeight: '900', color: '#fff' },
  memberText: { fontSize: 13, color: '#d6f5e6', lineHeight: 19 },
});
