import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from '../AppContext';
import { request } from '../request';
import { Back, Button, FadeIn, PressScale, produceIcon } from '../ui';
import AllergenReport, { isFood } from '../AllergenReport';

const BRAND = '#26408f',
  ACCENT = '#f5a524',
  INK = '#18213a',
  MUTED = '#6b7390';
const kindIcon: Record<string, string> = {
  HOME: '🛋️',
  FOOD: '🍲',
  EVENT: '🎉',
  OFFICE: '💼',
  PERSONAL: '🎒',
  CUSTOM: '📝',
};
const nairaToKobo = (v: string) => {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : null;
};
const koboToNaira = (k: number | null | undefined) =>
  k == null ? '' : String(Math.round(k / 100));
const statusLabel: Record<string, string> = {
  PLANNED: 'To buy',
  SAVED: 'Product chosen',
  PURCHASED: 'Bought',
  UNAVAILABLE: 'Unavailable',
  NOT_NEEDED: 'Not needed',
  OWNED: 'Have it',
};
const statusColor: Record<string, string> = {
  PLANNED: '#5d6684',
  SAVED: BRAND,
  PURCHASED: '#2f8a4e',
  UNAVAILABLE: '#a33e32',
  NOT_NEEDED: '#8a91a6',
  OWNED: '#2f8a4e',
};

/** My Planner: plans built from templates and recipes, linked to real products. No AI involved. */
export default function PlannerScreen({ onCartChanged }: { onCartChanged: () => void }) {
  const [view, setView] = useState<
    | { name: 'list' }
    | { name: 'new'; template: string; prefill?: any }
    | { name: 'plan'; id: string }
    | { name: 'diet' }
  >({ name: 'list' });
  if (view.name === 'new')
    return (
      <NewPlan
        template={view.template}
        prefill={view.prefill}
        onBack={() => setView({ name: 'list' })}
        onCreated={(id) => setView({ name: 'plan', id })}
      />
    );
  if (view.name === 'plan')
    return (
      <PlanView
        id={view.id}
        onBack={() => setView({ name: 'list' })}
        onOpen={(id) => setView({ name: 'plan', id })}
        onDiet={() => setView({ name: 'diet' })}
        onCartChanged={onCartChanged}
      />
    );
  if (view.name === 'diet') return <DietProfile onBack={() => setView({ name: 'list' })} />;
  return (
    <PlanList
      onNew={(template, prefill) => setView({ name: 'new', template, prefill })}
      onOpen={(id) => setView({ name: 'plan', id })}
      onDiet={() => setView({ name: 'diet' })}
    />
  );
}

function PlanList({
  onNew,
  onOpen,
  onDiet,
}: {
  onNew: (template: string, prefill?: any) => void;
  onOpen: (id: string) => void;
  onDiet: () => void;
}) {
  const { run, busy } = useApp();
  const [templates, setTemplates] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[] | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    void request('get', '/planner/templates')
      .then(setTemplates)
      .catch(() => {});
    void request('get', '/plans')
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);
  return (
    <View style={{ gap: 18 }}>
      <View>
        <Text style={styles.title}>My Planner</Text>
        <Text style={styles.sub}>
          Turn a goal into a shopping list with a budget, then buy from sellers near you.
        </Text>
      </View>
      <View style={styles.askBox}>
        <Text style={styles.askTitle}>What are you planning?</Text>
        <TextInput
          style={styles.askInput}
          value={text}
          onChangeText={setText}
          placeholder="e.g. Furnish a 2-bedroom flat with ₦5m"
          placeholderTextColor="#8a91a6"
          accessibilityLabel="Describe what you are planning"
          returnKeyType="go"
        />
        <Button
          title="Start planning"
          disabled={busy || !text.trim()}
          onPress={() =>
            void run(async () => {
              const read = await request('post', '/planner/read', { body: { text } });
              onNew(read.template, read);
            })
          }
        />
        <Text style={styles.fine}>Or pick a type of plan below.</Text>
      </View>
      <View style={styles.tiles}>
        {templates.map((t, i) => (
          <FadeIn key={t.key} delay={i * 40} style={styles.tileWrap}>
            <PressScale accessibilityRole="button" onPress={() => onNew(t.key)} style={styles.tile}>
              <Text style={{ fontSize: 30 }}>{kindIcon[t.kind] || '📝'}</Text>
              <Text style={styles.tileTitle}>{t.title}</Text>
              <Text numberOfLines={3} style={styles.tileText}>
                {t.description}
              </Text>
            </PressScale>
          </FadeIn>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={onDiet} style={styles.dietLink}>
        <Text style={{ fontSize: 22 }}>🥗</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Diet and allergies</Text>
          <Text style={styles.meta}>Hide recipes and flag foods that don’t suit you.</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>
      <Text style={styles.section}>Your plans</Text>
      {plans === null ? (
        <ActivityIndicator color={BRAND} />
      ) : !plans.length ? (
        <Text style={styles.meta}>No plans yet. Start one above.</Text>
      ) : (
        plans.map((p, i) => (
          <FadeIn key={p.id} delay={i * 50}>
            <PressScale
              accessibilityRole="button"
              onPress={() => onOpen(p.id)}
              style={styles.planCard}
            >
              <View style={styles.rowCenter}>
                <Text style={{ fontSize: 26 }}>{kindIcon[p.kind] || '📝'}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {p.title}
                  </Text>
                  <Text style={styles.meta}>
                    {p.summary.done_count}/{p.summary.item_count} done
                    {p.status !== 'ACTIVE' ? ` · ${p.status.toLowerCase()}` : ''}
                    {p.target_date ? ` · by ${p.target_date}` : ''}
                  </Text>
                  {p.access !== 'OWNER' && (
                    <Text style={styles.shared}>
                      Shared by {p.owner_name} · {p.access === 'EDITOR' ? 'can edit' : 'view only'}
                    </Text>
                  )}
                </View>
                <Text style={styles.chev}>›</Text>
              </View>
              <BudgetBar summary={p.summary} compact />
            </PressScale>
          </FadeIn>
        ))
      )}
    </View>
  );
}

function BudgetBar({ summary, compact = false }: { summary: any; compact?: boolean }) {
  const budget = summary.budget_kobo;
  const base = budget || summary.estimate_kobo || 1;
  const spentShare = Math.min(1, summary.spent_kobo / base);
  const estimateShare = Math.min(1, summary.estimate_kobo / base);
  const over = summary.over_budget_kobo > 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.bar}>
        <View
          style={[
            styles.barFill,
            { width: `${estimateShare * 100}%`, backgroundColor: over ? '#f3c2b8' : '#cfd8f2' },
          ]}
        />
        <View style={[styles.barFill, { width: `${spentShare * 100}%`, backgroundColor: BRAND }]} />
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>Spent {money(summary.spent_kobo)}</Text>
        <Text style={[styles.meta, over && { color: '#a33e32', fontWeight: '700' }]}>
          {budget == null
            ? `Estimate ${money(summary.estimate_kobo)}`
            : over
              ? `${money(summary.over_budget_kobo)} over`
              : `${money(summary.remaining_kobo)} left of ${money(budget)}`}
        </Text>
      </View>
      {!compact && (
        <Text style={styles.fine}>
          Estimate {money(summary.estimate_kobo)} · requested {money(summary.requested_kobo)}
        </Text>
      )}
    </View>
  );
}

function NewPlan({
  template,
  prefill,
  onBack,
  onCreated,
}: {
  template: string;
  prefill?: any;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const { run, busy } = useApp();
  const [templates, setTemplates] = useState<any[]>([]);
  const [key, setKey] = useState(template);
  const [title, setTitle] = useState<string>(prefill?.title || '');
  const [budget, setBudget] = useState(koboToNaira(prefill?.budget_kobo));
  const [people, setPeople] = useState(prefill?.people ? String(prefill.people) : '');
  const [rooms, setRooms] = useState(prefill?.rooms ? String(prefill.rooms) : '');
  const [tier, setTier] = useState<'BASIC' | 'STANDARD' | 'PREMIUM'>('STANDARD');
  const [date, setDate] = useState('');
  useEffect(() => {
    void request('get', '/planner/templates')
      .then(setTemplates)
      .catch(() => {});
  }, []);
  const t = templates.find((x) => x.key === key);
  const asks = (q: string) => !!t?.questions.includes(q);
  return (
    <View style={{ gap: 16 }}>
      <Back onPress={onBack} />
      <Text style={styles.title}>New plan</Text>
      <View style={styles.chips}>
        {templates.map((x) => (
          <Chipish
            key={x.key}
            label={`${kindIcon[x.kind]} ${x.title}`}
            active={x.key === key}
            onPress={() => setKey(x.key)}
          />
        ))}
      </View>
      {t && <Text style={styles.meta}>{t.description}</Text>}
      <Labelled label="Name">
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t?.title || 'My plan'}
          placeholderTextColor="#8a91a6"
        />
      </Labelled>
      {asks('budget') && (
        <Labelled label="Budget (₦) — leave empty if you haven’t decided">
          <TextInput
            style={styles.input}
            value={budget}
            onChangeText={setBudget}
            keyboardType="numeric"
            placeholder="e.g. 500000"
            placeholderTextColor="#8a91a6"
          />
        </Labelled>
      )}
      <View style={styles.rowGap}>
        {asks('rooms') && (
          <Labelled label={t?.rooms_label || 'Rooms'} flex>
            <TextInput
              style={styles.input}
              value={rooms}
              onChangeText={setRooms}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor="#8a91a6"
            />
          </Labelled>
        )}
        {asks('people') && (
          <Labelled label={t?.people_label || 'People'} flex>
            <TextInput
              style={styles.input}
              value={people}
              onChangeText={setPeople}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor="#8a91a6"
            />
          </Labelled>
        )}
      </View>
      {asks('tier') && (
        <Labelled label="Quality">
          <View style={styles.chips}>
            {(['BASIC', 'STANDARD', 'PREMIUM'] as const).map((x) => (
              <Chipish
                key={x}
                label={x[0] + x.slice(1).toLowerCase()}
                active={tier === x}
                onPress={() => setTier(x)}
              />
            ))}
          </View>
        </Labelled>
      )}
      {asks('target_date') && (
        <Labelled label="Target date (optional, YYYY-MM-DD)">
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="2026-12-20"
            placeholderTextColor="#8a91a6"
          />
        </Labelled>
      )}
      <Button
        title={busy ? 'Creating…' : 'Create my plan'}
        disabled={busy || !t}
        onPress={() =>
          void run(async () => {
            const created = await request('post', '/plans', {
              body: {
                template: key,
                ...(title.trim() ? { title: title.trim() } : {}),
                budget_kobo: nairaToKobo(budget),
                people: people ? Number(people) : null,
                rooms: rooms ? Number(rooms) : null,
                tier,
                target_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
              },
            });
            onCreated(created.id);
          })
        }
      />
      <Text style={styles.fine}>
        The plan is a starting point: change, add or remove anything. Prices are estimates until you
        pick real products.
      </Text>
    </View>
  );
}

function PlanView({
  id,
  onBack,
  onOpen,
  onDiet,
  onCartChanged,
}: {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onDiet: () => void;
  onCartChanged: () => void;
}) {
  const { run, busy } = useApp();
  const [plan, setPlan] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [mealPicker, setMealPicker] = useState(false);
  const [editBudget, setEditBudget] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const load = useCallback(
    async () => setPlan(await request('get', '/plans/{id}', { params: { id } })),
    [id],
  );
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  if (!plan) return <ActivityIndicator color={BRAND} style={{ marginTop: 40 }} />;
  const sections: Record<string, any[]> = {};
  for (const item of plan.items) (sections[item.section] ||= []).push(item);
  const act = (fn: () => Promise<unknown>, message?: string) =>
    void run(async () => {
      await fn();
      await load();
    }, message);
  const s = plan.summary;
  return (
    <View style={{ gap: 16 }}>
      <Back onPress={onBack} />
      <View>
        <Text style={styles.kicker}>
          {kindIcon[plan.kind]} {plan.tier.toLowerCase()} plan
          {plan.status !== 'ACTIVE' ? ` · ${plan.status.toLowerCase()}` : ''}
        </Text>
        <Text style={styles.title}>{plan.title}</Text>
        {plan.target_date && <Text style={styles.meta}>Target: {plan.target_date}</Text>}
      </View>

      <View style={styles.summary}>
        <View style={styles.rowBetween}>
          <Text style={styles.rowTitle}>Budget</Text>
          <Pressable onPress={() => setEditBudget(koboToNaira(s.budget_kobo))}>
            <Text style={styles.link}>
              {s.budget_kobo == null ? 'Set budget' : money(s.budget_kobo)} ✎
            </Text>
          </Pressable>
        </View>
        {editBudget !== null && (
          <View style={styles.rowGap}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={editBudget}
              onChangeText={setEditBudget}
              keyboardType="numeric"
              placeholder="Budget in ₦"
              placeholderTextColor="#8a91a6"
            />
            <Button
              title="Save"
              onPress={() =>
                act(async () => {
                  await request('patch', '/plans/{id}', {
                    params: { id },
                    body: { budget_kobo: nairaToKobo(editBudget) },
                  });
                  setEditBudget(null);
                })
              }
            />
          </View>
        )}
        <BudgetBar summary={s} />
        <View style={styles.statRow}>
          <Stat label="Estimate" value={money(s.estimate_kobo)} />
          <Stat label="Spent" value={money(s.spent_kobo)} />
          <Stat
            label="Remaining"
            value={s.remaining_kobo == null ? '—' : money(s.remaining_kobo)}
          />
        </View>
        {s.suggestions.map((x: string) => (
          <Text key={x} style={styles.warn}>
            • {x}
          </Text>
        ))}
        {s.sections.length > 1 && (
          <View style={{ gap: 6 }}>
            {s.sections.map((sec: any) => (
              <View key={sec.section} style={styles.rowCenter}>
                <Text style={[styles.meta, { width: 110 }]} numberOfLines={1}>
                  {sec.section}
                </Text>
                <View style={[styles.bar, { flex: 1, height: 8 }]}>
                  <View
                    style={[styles.barFill, { width: `${sec.share}%`, backgroundColor: ACCENT }]}
                  />
                </View>
                <Text style={[styles.meta, { width: 44, textAlign: 'right' }]}>
                  {Math.round(sec.share)}%
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.fine}>{s.note}</Text>
      </View>

      <View style={styles.actionsRow}>
        <SmallButton
          label={plan.status === 'ACTIVE' ? 'Pause' : 'Resume'}
          onPress={() =>
            act(() =>
              request('patch', '/plans/{id}', {
                params: { id },
                body: { status: plan.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' },
              }),
            )
          }
        />
        <SmallButton
          label="Mark done"
          onPress={() =>
            act(() =>
              request('patch', '/plans/{id}', { params: { id }, body: { status: 'COMPLETED' } }),
            )
          }
        />
        <SmallButton label="👪 Share" primary onPress={() => setSharing(!sharing)} />
        <SmallButton
          label="Duplicate"
          onPress={() =>
            void run(async () => {
              const copy = await request('post', '/plans/{id}/duplicate', {
                params: { id },
                body: {},
              });
              onOpen(copy.id);
            }, 'Plan copied.')
          }
        />
        <SmallButton
          label="Delete"
          danger
          onPress={() =>
            void run(async () => {
              await request('delete', '/plans/{id}', { params: { id } });
              onBack();
            }, 'Plan deleted.')
          }
        />
      </View>

      {plan.access && plan.access !== 'OWNER' && (
        <Text style={styles.notice}>
          Shared with you by {plan.owner_name ?? 'the owner'} ·{' '}
          {plan.access === 'EDITOR' ? 'you can edit it together' : 'view only'}
        </Text>
      )}
      {sharing && <SharePanel planId={id} />}

      {plan.kind === 'FOOD' && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.section}>Meals</Text>
            <Pressable onPress={onDiet}>
              <Text style={styles.link}>Diet and allergies</Text>
            </Pressable>
          </View>
          {!plan.meals.length && (
            <Text style={styles.meta}>Add recipes, then build your grocery list.</Text>
          )}
          {plan.meals.map((m: any) => (
            <View key={m.id} style={styles.mealRow}>
              <Text style={styles.dayPill}>Day {m.day}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{m.recipe_name}</Text>
                <Text style={styles.meta}>
                  {m.meal.toLowerCase()} · {m.servings} serving{m.servings === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Remove meal"
                onPress={() =>
                  act(() =>
                    request('delete', '/plans/{id}/meals/{mealId}', {
                      params: { id, mealId: m.id },
                    }),
                  )
                }
              >
                <Text style={styles.remove}>×</Text>
              </Pressable>
            </View>
          ))}
          {mealPicker ? (
            <RecipePicker
              people={plan.people || 2}
              nextDay={Math.min(31, (plan.meals.at(-1)?.day || 0) + 1)}
              onCancel={() => setMealPicker(false)}
              onAdd={(body) =>
                act(async () => {
                  const r = await request('post', '/plans/{id}/meals', { params: { id }, body });
                  setMealPicker(false);
                  return r;
                }, 'Meal added.')
              }
            />
          ) : (
            <View style={styles.rowGap}>
              <SmallButton label="+ Add a meal" onPress={() => setMealPicker(true)} />
              {!!plan.meals.length && (
                <SmallButton
                  label="Build grocery list"
                  primary
                  onPress={() =>
                    act(
                      () =>
                        request('post', '/plans/{id}/grocery-list', { params: { id }, body: {} }),
                      'Grocery list updated.',
                    )
                  }
                />
              )}
            </View>
          )}
        </View>
      )}

      {Object.entries(sections).map(([section, items]) => (
        <View key={section} style={{ gap: 8 }}>
          <Text style={styles.section}>{section}</Text>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              planId={id}
              item={item}
              open={open === item.id}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
              onChanged={load}
              onCartChanged={onCartChanged}
            />
          ))}
        </View>
      ))}

      {adding ? (
        <AddItem
          onCancel={() => setAdding(false)}
          onAdd={(body) =>
            act(async () => {
              await request('post', '/plans/{id}/items', { params: { id }, body });
              setAdding(false);
            })
          }
        />
      ) : (
        <Button secondary title="+ Add an item" disabled={busy} onPress={() => setAdding(true)} />
      )}
    </View>
  );
}

function ItemRow({
  planId,
  item,
  open,
  onToggle,
  onChanged,
  onCartChanged,
}: {
  planId: string;
  item: any;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onCartChanged: () => void;
}) {
  const { run, busy } = useApp();
  const [matches, setMatches] = useState<any | null>(null);
  const [qty, setQty] = useState(String(item.quantity));
  const [estimate, setEstimate] = useState(koboToNaira(item.budget_kobo));
  const params = { id: planId, itemId: item.id };
  const update = (body: any, message?: string) =>
    void run(async () => {
      await request('patch', '/plans/{id}/items/{itemId}', { params, body });
      await onChanged();
    }, message);
  const find = (sort: 'best' | 'price') =>
    void run(async () => {
      setMatches(
        await request('get', '/plans/{id}/items/{itemId}/matches', { params, query: { sort } }),
      );
    });
  const done = ['PURCHASED', 'OWNED', 'NOT_NEEDED'].includes(item.status);
  return (
    <View style={[styles.item, done && { opacity: 0.6 }]}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.rowCenter}>
        <View
          style={[
            styles.check,
            done && {
              backgroundColor: statusColor[item.status],
              borderColor: statusColor[item.status],
            },
          ]}
        >
          {done && <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.rowTitle, done && { textDecorationLine: 'line-through' }]}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          <Text style={styles.meta}>
            {item.quantity} {item.unit} · est. {money(item.budget_kobo)}
            {item.priority !== 'IMPORTANT' ? ` · ${item.priority.toLowerCase()}` : ''}
          </Text>
          {item.listing && (
            <Text style={styles.linked} numberOfLines={1}>
              ↳ {item.listing.title} ·{' '}
              {item.listing.price_kobo == null ? '' : money(item.listing.price_kobo)}
              {item.listing.available ? '' : ' · unavailable'}
            </Text>
          )}
          {item.allergy_warning && <Text style={styles.allergy}>⚠️ {item.allergy_warning}</Text>}
        </View>
        <Text style={[styles.statusPill, { color: statusColor[item.status] }]}>
          {statusLabel[item.status]}
        </Text>
      </Pressable>
      {open && (
        <View style={{ gap: 10, marginTop: 10 }}>
          <View style={styles.chips}>
            {(['PLANNED', 'PURCHASED', 'OWNED', 'NOT_NEEDED'] as const).map((x) => (
              <Chipish
                key={x}
                label={statusLabel[x]}
                active={item.status === x}
                onPress={() => update({ status: x })}
              />
            ))}
          </View>
          <View style={styles.chips}>
            {(['ESSENTIAL', 'IMPORTANT', 'OPTIONAL'] as const).map((x) => (
              <Chipish
                key={x}
                label={x[0] + x.slice(1).toLowerCase()}
                active={item.priority === x}
                onPress={() => update({ priority: x })}
              />
            ))}
          </View>
          <View style={styles.rowGap}>
            <Labelled label={`Quantity (${item.unit})`} flex>
              <TextInput
                style={styles.input}
                value={qty}
                onChangeText={setQty}
                keyboardType="numeric"
              />
            </Labelled>
            <Labelled label="Estimate (₦)" flex>
              <TextInput
                style={styles.input}
                value={estimate}
                onChangeText={setEstimate}
                keyboardType="numeric"
              />
            </Labelled>
          </View>
          <View style={styles.rowGap}>
            <SmallButton
              label="Save changes"
              onPress={() =>
                update(
                  {
                    quantity: Number(qty) || item.quantity,
                    budget_kobo: nairaToKobo(estimate) ?? item.budget_kobo,
                  },
                  'Saved.',
                )
              }
            />
            <SmallButton
              label="Remove"
              danger
              onPress={() =>
                void run(async () => {
                  await request('delete', '/plans/{id}/items/{itemId}', { params });
                  await onChanged();
                })
              }
            />
          </View>
          <View style={styles.rowGap}>
            <SmallButton label="🔎 Find products" primary onPress={() => find('best')} />
            <SmallButton label="Cheaper options" onPress={() => find('price')} />
          </View>
          {matches && (
            <View style={{ gap: 10 }}>
              {!matches.items.length && (
                <Text style={styles.meta}>
                  No matching products yet. Try again later or edit the item name.
                </Text>
              )}
              {matches.items.map((m: any) => (
                <View key={m.listing_id} style={styles.match}>
                  <View style={styles.matchThumb}>
                    {m.thumbnail_url || m.image_url ? (
                      <Image
                        source={{ uri: m.thumbnail_url || m.image_url }}
                        style={StyleSheet.absoluteFill}
                      />
                    ) : (
                      <Text style={{ fontSize: 26 }}>{produceIcon(m.category)}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    {m.sponsored && <Text style={styles.sponsored}>SPONSORED</Text>}
                    <Text numberOfLines={2} style={styles.rowTitle}>
                      {m.title}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {m.business_name} · {m.area}
                    </Text>
                    <Text style={styles.matchPrice}>
                      {money(m.price_kobo)}
                      <Text style={styles.meta}> / {m.unit}</Text>
                    </Text>
                    <Text
                      style={[styles.meta, { color: m.within_estimate ? '#2f8a4e' : '#a33e32' }]}
                      numberOfLines={2}
                    >
                      {m.reasons.join(' · ')}
                    </Text>
                    {m.allergen_note && <Text style={styles.allergy}>{m.allergen_note}</Text>}
                    {isFood(m.category) && <AllergenReport listingId={m.listing_id} />}
                    <View style={styles.rowGap}>
                      <SmallButton
                        label="Add to cart"
                        primary
                        disabled={busy || !m.in_stock}
                        onPress={() =>
                          void run(async () => {
                            await request('post', '/cart', {
                              body: {
                                listing_id: m.listing_id,
                                variant_id: m.variant_id,
                                quantity:
                                  m.unit === item.unit ? Math.max(1, Math.ceil(item.quantity)) : 1,
                                plan_item_id: item.id,
                              },
                            });
                            onCartChanged();
                            await onChanged();
                          }, 'Added to your cart.')
                        }
                      />
                      <SmallButton
                        label="Choose"
                        onPress={() =>
                          update(
                            { listing_id: m.listing_id, variant_id: m.variant_id },
                            'Product saved to your plan.',
                          )
                        }
                      />
                    </View>
                  </View>
                </View>
              ))}
              <Text style={styles.fine}>{matches.note}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function SharePanel({ planId }: { planId: string }) {
  const { run, busy } = useApp();
  const [data, setData] = useState<any>(null);
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const load = () =>
    void request('get', '/plans/{id}/members', { params: { id: planId } })
      .then(setData)
      .catch(() => {});
  useEffect(load, [planId]);
  return (
    <View style={styles.card}>
      <Text style={styles.section}>Share with family</Text>
      <Text style={styles.meta}>
        Add people by the email or phone number they use on Ahia. Editors can tick off items and add
        things; viewers can only look.
      </Text>
      {data?.members.map((m: any) => (
        <View key={m.user_id} style={styles.rowBetween}>
          <Text style={styles.rowTitle}>
            {m.name} · {m.role === 'EDITOR' ? 'can edit' : 'view only'}
          </Text>
          {data.you === 'OWNER' && (
            <SmallButton
              label="Remove"
              danger
              onPress={() =>
                void run(async () => {
                  await request('delete', '/plans/{id}/members/{userId}', {
                    params: { id: planId, userId: m.user_id },
                  });
                  load();
                })
              }
            />
          )}
        </View>
      ))}
      {data?.you === 'OWNER' && (
        <>
          <TextInput
            style={styles.input}
            value={contact}
            onChangeText={setContact}
            placeholder="Their email or phone number"
            placeholderTextColor="#8a91a6"
          />
          <View style={styles.chips}>
            <Chipish
              label="Can edit"
              active={role === 'EDITOR'}
              onPress={() => setRole('EDITOR')}
            />
            <Chipish
              label="View only"
              active={role === 'VIEWER'}
              onPress={() => setRole('VIEWER')}
            />
          </View>
          <SmallButton
            label="Share plan"
            primary
            disabled={busy || contact.trim().length < 5}
            onPress={() =>
              void run(async () => {
                const r = await request('post', '/plans/{id}/members', {
                  params: { id: planId },
                  body: { contact: contact.trim(), role },
                });
                setContact('');
                load();
                return r;
              }, 'Plan shared. They’ll get a notification.')
            }
          />
        </>
      )}
    </View>
  );
}

function AddItem({ onAdd, onCancel }: { onAdd: (body: any) => void; onCancel: () => void }) {
  const [name, setName] = useState(''),
    [qty, setQty] = useState('1'),
    [unit, setUnit] = useState('piece'),
    [estimate, setEstimate] = useState(''),
    [section, setSection] = useState('Items');
  return (
    <View style={styles.card}>
      <Text style={styles.section}>Add an item</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="What do you need?"
        placeholderTextColor="#8a91a6"
      />
      <View style={styles.rowGap}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={qty}
          onChangeText={setQty}
          keyboardType="numeric"
          placeholder="Qty"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={unit}
          onChangeText={setUnit}
          placeholder="Unit"
        />
      </View>
      <TextInput
        style={styles.input}
        value={estimate}
        onChangeText={setEstimate}
        keyboardType="numeric"
        placeholder="Estimated cost for all (₦), optional"
        placeholderTextColor="#8a91a6"
      />
      <TextInput
        style={styles.input}
        value={section}
        onChangeText={setSection}
        placeholder="Group (e.g. Kitchen)"
        placeholderTextColor="#8a91a6"
      />
      <View style={styles.rowGap}>
        <SmallButton
          label="Add"
          primary
          disabled={!name.trim()}
          onPress={() =>
            onAdd({
              name: name.trim(),
              keywords: name.trim(),
              quantity: Number(qty) || 1,
              unit: unit.trim() || 'piece',
              budget_kobo: nairaToKobo(estimate) ?? 0,
              section: section.trim() || 'Items',
            })
          }
        />
        <SmallButton label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

function RecipePicker({
  people,
  nextDay,
  onAdd,
  onCancel,
}: {
  people: number;
  nextDay: number;
  onAdd: (body: any) => void;
  onCancel: () => void;
}) {
  const [recipes, setRecipes] = useState<any[] | null>(null);
  const [day, setDay] = useState(String(nextDay));
  const [servings, setServings] = useState(String(people));
  const [meal, setMeal] = useState<'BREAKFAST' | 'LUNCH' | 'DINNER'>('DINNER');
  const [showExcluded, setShowExcluded] = useState(false);
  useEffect(() => {
    void request('get', '/planner/recipes')
      .then(setRecipes)
      .catch(() => setRecipes([]));
  }, []);
  if (!recipes) return <ActivityIndicator color={BRAND} />;
  const usable = recipes.filter((r) => r.diet_status !== 'EXCLUDED' && r.meals.includes(meal));
  const excluded = recipes.filter((r) => r.diet_status === 'EXCLUDED');
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.chips}>
        {(['BREAKFAST', 'LUNCH', 'DINNER'] as const).map((x) => (
          <Chipish
            key={x}
            label={x[0] + x.slice(1).toLowerCase()}
            active={meal === x}
            onPress={() => setMeal(x)}
          />
        ))}
      </View>
      <View style={styles.rowGap}>
        <Labelled label="Day" flex>
          <TextInput
            style={styles.input}
            value={day}
            onChangeText={setDay}
            keyboardType="number-pad"
          />
        </Labelled>
        <Labelled label="Servings" flex>
          <TextInput
            style={styles.input}
            value={servings}
            onChangeText={setServings}
            keyboardType="number-pad"
          />
        </Labelled>
      </View>
      {usable.map((r) => (
        <Pressable
          key={r.key}
          accessibilityRole="button"
          onPress={() =>
            onAdd({ recipe: r.key, day: Number(day) || 1, meal, servings: Number(servings) || 1 })
          }
          style={styles.recipe}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{r.name}</Text>
            <Text style={styles.meta} numberOfLines={2}>
              {r.description} · about {money(r.estimated_cost_per_serving_kobo)} a serving ·{' '}
              {r.time_minutes} min
            </Text>
            {r.diet_status === 'WARNING' && (
              <Text style={styles.allergy}>⚠️ {r.diet_reasons.join('; ')}</Text>
            )}
            <AllergenReport recipe={r.key} />
          </View>
          <Text style={styles.add}>＋</Text>
        </Pressable>
      ))}
      {!!excluded.length && (
        <Pressable onPress={() => setShowExcluded(!showExcluded)}>
          <Text style={styles.link}>
            {showExcluded ? 'Hide' : 'Show'} {excluded.length} recipe
            {excluded.length === 1 ? '' : 's'} hidden by your diet profile
          </Text>
        </Pressable>
      )}
      {showExcluded &&
        excluded.map((r) => (
          <View key={r.key} style={[styles.recipe, { opacity: 0.55 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.name}</Text>
              <Text style={styles.allergy}>{r.diet_reasons.join('; ')}</Text>
            </View>
          </View>
        ))}
      <SmallButton label="Cancel" onPress={onCancel} />
    </View>
  );
}

function DietProfile({ onBack }: { onBack: () => void }) {
  const { run, busy } = useApp();
  const [data, setData] = useState<any>(null);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [intolerances, setIntolerances] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [avoid, setAvoid] = useState('');
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    void request('get', '/planner/diet-profile').then((d) => {
      setData(d);
      setAllergies(d.profile.allergies);
      setIntolerances(d.profile.intolerances);
      setPatterns(d.profile.patterns);
      setAvoid(d.profile.avoid.join(', '));
      setConsent(!!d.profile.consented_at);
    });
  }, []);
  if (!data) return <ActivityIndicator color={BRAND} style={{ marginTop: 40 }} />;
  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  return (
    <View style={{ gap: 16 }}>
      <Back onPress={onBack} />
      <Text style={styles.title}>Diet and allergies</Text>
      <Text style={styles.notice}>{data.notice}</Text>
      <Labelled label="Allergies">
        <View style={styles.chips}>
          {data.allergen_options.map((o: any) => (
            <Chipish
              key={o.key}
              label={o.label}
              active={allergies.includes(o.key)}
              onPress={() => toggle(allergies, setAllergies, o.key)}
            />
          ))}
        </View>
      </Labelled>
      <Labelled label="Intolerances (milder; recipes are flagged, not hidden)">
        <View style={styles.chips}>
          {data.allergen_options.map((o: any) => (
            <Chipish
              key={o.key}
              label={o.label}
              active={intolerances.includes(o.key)}
              onPress={() => toggle(intolerances, setIntolerances, o.key)}
            />
          ))}
        </View>
      </Labelled>
      <Labelled label="Diet">
        <View style={styles.chips}>
          {data.pattern_options.map((o: any) => (
            <Chipish
              key={o.key}
              label={o.label}
              active={patterns.includes(o.key)}
              onPress={() => toggle(patterns, setPatterns, o.key)}
            />
          ))}
        </View>
      </Labelled>
      <Labelled label="Foods you avoid (comma separated, e.g. ponmo, okra)">
        <TextInput
          style={styles.input}
          value={avoid}
          onChangeText={setAvoid}
          placeholder="Optional"
          placeholderTextColor="#8a91a6"
        />
      </Labelled>
      {(allergies.length > 0 || intolerances.length > 0) && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          onPress={() => setConsent(!consent)}
          style={styles.rowCenter}
        >
          <View style={[styles.check, consent && { backgroundColor: BRAND, borderColor: BRAND }]}>
            {consent && <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text>}
          </View>
          <Text style={[styles.meta, { flex: 1 }]}>
            I agree to Ahia storing my allergy information to filter recipes and flag products for
            me.
          </Text>
        </Pressable>
      )}
      <Button
        title={busy ? 'Saving…' : 'Save'}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await request('put', '/planner/diet-profile', {
              body: {
                allergies,
                intolerances,
                patterns: patterns as any,
                avoid: avoid
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
                consent,
              },
            });
            onBack();
          }, 'Diet profile saved.')
        }
      />
      <Button
        secondary
        title="Delete my diet profile"
        onPress={() =>
          void run(async () => {
            await request('delete', '/planner/diet-profile');
            onBack();
          }, 'Diet profile deleted.')
        }
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
function Labelled({
  label,
  children,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  flex?: boolean;
}) {
  return (
    <View style={[{ gap: 6 }, flex && { flex: 1 }]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}
function Chipish({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn]}
    >
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}
function SmallButton({
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

const styles = StyleSheet.create({
  shared: { fontSize: 11, fontWeight: '700', color: '#b57a10', marginTop: 2 },
  title: { fontSize: 26, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 19 },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  section: { fontSize: 17, fontWeight: '800', color: INK },
  meta: { fontSize: 12, color: MUTED, lineHeight: 17 },
  fine: { fontSize: 11, color: '#7e86a0', lineHeight: 16 },
  notice: {
    fontSize: 13,
    color: '#3d4563',
    backgroundColor: '#fff4e0',
    padding: 12,
    borderRadius: 12,
    lineHeight: 19,
  },
  link: { fontSize: 13, fontWeight: '700', color: BRAND },
  label: { fontSize: 12, fontWeight: '700', color: '#3d4563' },
  input: {
    borderWidth: 1,
    borderColor: '#d4d9e8',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: INK,
  },
  askBox: {
    backgroundColor: '#eef1fa',
    borderRadius: 20,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#dfe5f5',
  },
  askTitle: { fontSize: 17, fontWeight: '800', color: INK },
  askInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: INK,
    borderWidth: 1,
    borderColor: '#d4d9e8',
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileWrap: { width: '47.8%' },
  tile: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    gap: 6,
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#e2e6f0',
  },
  tileTitle: { fontSize: 15, fontWeight: '800', color: INK },
  tileText: { fontSize: 12, color: MUTED, lineHeight: 17 },
  dietLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#e9f6ef',
  },
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e6f0',
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowGap: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: INK },
  chev: { fontSize: 24, color: '#9aa1b5' },
  bar: { height: 12, borderRadius: 6, backgroundColor: '#eef0f5', overflow: 'hidden' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
  summary: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e6f0',
  },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: '#f4f6fb', borderRadius: 12, padding: 10 },
  statLabel: { fontSize: 11, color: MUTED, fontWeight: '600' },
  statValue: { fontSize: 15, color: INK, fontWeight: '800', marginTop: 2 },
  warn: { fontSize: 13, color: '#8a3b20', lineHeight: 19 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e6f0',
  },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayPill: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    backgroundColor: ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  remove: { fontSize: 22, color: '#a33e32', paddingHorizontal: 6 },
  item: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e6e9f1',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#c5cbdb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linked: { fontSize: 12, color: BRAND, fontWeight: '600', marginTop: 2 },
  allergy: { fontSize: 12, color: '#a33e32', fontWeight: '600', lineHeight: 17 },
  statusPill: { fontSize: 11, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d4d9e8',
  },
  chipOn: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 13, fontWeight: '600', color: '#3a4770' },
  small: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#eef1f8',
  },
  smallText: { fontSize: 13, fontWeight: '700', color: BRAND },
  match: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#f7f8fc',
  },
  matchThumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#e3e8f5',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchPrice: { fontSize: 16, fontWeight: '800', color: BRAND },
  sponsored: { fontSize: 9, letterSpacing: 1, fontWeight: '800', color: '#a17e41' },
  recipe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#f7f8fc',
  },
  add: { fontSize: 24, color: BRAND, fontWeight: '700' },
});
