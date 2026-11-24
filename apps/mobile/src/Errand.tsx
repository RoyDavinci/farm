import { marketMeasure, money } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
import { featureOn } from './features';
import { currentPosition } from './location';
import { request } from './request';
import { PointFields } from './RiderPicker';
import { Button, Chip, Field, s } from './ui';

const SLOTS = [10, 12, 14, 16, 18, 20];
/** Delivery time choices: today/tomorrow/day after × 2-hour slots, at least 90 min away. */
function slots() {
  const out: { day: string; label: string; iso: string }[] = [];
  for (let d = 0; d < 3; d++)
    for (const h of SLOTS) {
      const t = new Date();
      t.setDate(t.getDate() + d);
      t.setHours(h, 0, 0, 0);
      if (t.getTime() < Date.now() + 90 * 60000) continue;
      out.push({
        day:
          d === 0
            ? 'Today'
            : d === 1
              ? 'Tomorrow'
              : t.toLocaleDateString(undefined, { weekday: 'long' }),
        label: `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`,
        iso: t.toISOString(),
      });
    }
  return out;
}

/**
 * "Buy it and bring it": type what you want ("I want to make egusi for 6"), check the basket
 * Ahia builds from nearby shops, pick where and when, and it's delivered then.
 *
 * 1. Tell us what you're cooking (plus a budget and anything to leave out, if you like).
 * 2. Check the list: remove what you already have, change amounts. Allergies from the Planner
 *    diet profile and "leave out" words are taken off automatically.
 * 3. Each shop packs its part, a rider brings it at the chosen time, and you pay on delivery.
 * Things no shop nearby sells can be sent to sellers as a request, or bought by a rider.
 */
/** Ready-made shopping lists: Buy it & bring it is for anything, not just cooking. */
const LISTS: [string, string][] = [
  ['🍼 Baby things', 'diapers size 3, baby wipes, 2 tins of baby milk'],
  ['🧴 Toiletries', 'toothpaste, bathing soap, toilet roll, detergent'],
  ['🍞 Breakfast', 'bread, 12 eggs, tin of milk, Milo'],
  ['🥤 Party drinks', '2 packs of soft drinks, 12 bottles of water, disposable cups'],
  ['🧹 Cleaning', 'bleach, detergent, mop, dishwashing liquid'],
  ['🔌 Phone bits', 'phone charger, earphones, power bank'],
];

export default function ErrandPanel({
  startOpen = false,
  onClose,
}: { startOpen?: boolean; onClose?: () => void } = {}) {
  const { busy, run, setTab, settings } = useApp();
  const [text, setText] = useState(''),
    [ideas, setIdeas] = useState<any[]>([]),
    [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null),
    [address, setAddress] = useState(''),
    [budget, setBudget] = useState(''),
    [avoid, setAvoid] = useState(''),
    [plan, setPlan] = useState<any>(null),
    [qty, setQty] = useState<Record<string, number>>({}),
    [skip, setSkip] = useState<Record<string, boolean>>({}),
    [when, setWhen] = useState<string | null>(null),
    [note, setNote] = useState(''),
    [placed, setPlaced] = useState<any>(null),
    [asked, setAsked] = useState(false),
    [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (open && !ideas.length)
      void request('get', '/errands/ideas')
        .then((r) => setIdeas((r as any[]).slice(0, 8)))
        .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const budgetKobo = Math.round(Number(budget.replace(/[^\d.]/g, '')) * 100) || 0;
  const avoidList = avoid
    .split(/,|\n/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 15);
  const find = (servings?: number) =>
    void run(async () => {
      const p: any = await request('post', '/errands/plan', {
        body: {
          text: text.trim(),
          latitude: point!.latitude,
          longitude: point!.longitude,
          ...(servings ? { servings } : {}),
          ...(budgetKobo >= 10000 ? { budget_kobo: budgetKobo } : {}),
          ...(avoidList.length ? { avoid: avoidList } : {}),
        } as any,
      });
      setPlan(p);
      setQty({});
      setAsked(false);
      // Off the list to start: things you can't eat, extra rider trips and far-too-big packs.
      setSkip(
        Object.fromEntries(
          p.items
            .filter((i: any) => i.diet?.status === 'AVOID' || i.extra_trip_kobo || i.oversized)
            .map((i: any) => [i.key, true]),
        ),
      );
    });
  if (!open)
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.teaser}>
        <Text style={styles.teaserTitle}>🛵 Buy it & bring it</Text>
        <Text style={styles.teaserText}>
          Type what you need, e.g. “I want to make egusi for 6”. We find it nearby and deliver at
          your time.
        </Text>
      </Pressable>
    );
  if (placed)
    return (
      <View style={s.locationBox}>
        <Text style={s.bold}>
          ✅ Sent to {placed.orders.length} shop{placed.orders.length === 1 ? '' : 's'}
        </Text>
        <Text style={s.small}>
          Each shop confirms its basket, then a rider brings it{' '}
          {new Date(placed.deliver_at).toLocaleString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}
          . You pay when it arrives. Follow it in Orders.
        </Text>
        <Pressable
          onPress={() => {
            setPlaced(null);
            setPlan(null);
            setText('');
          }}
        >
          <Text style={s.link}>Start another</Text>
        </Pressable>
      </View>
    );
  const items: any[] = plan?.items ?? [];
  const kept = items.filter((i) => !skip[i.key]);
  const chosen = kept.filter((i) => i.listing);
  const notFound = kept.filter((i) => !i.listing);
  const removed = items.filter((i) => skip[i.key]);
  // A portion (0.1 kg of crayfish) until the person picks whole units with the stepper.
  const amountOf = (i: any): number => qty[i.key] ?? i.portion ?? i.quantity;
  const lineOf = (i: any) => Math.round(i.listing.price_kobo * amountOf(i));
  const goods = chosen.reduce((sum: number, i: any) => sum + lineOf(i), 0);
  const shops = new Set(chosen.map((i: any) => i.listing.seller_id));
  const delivery = (plan?.sellers ?? [])
    .filter((x: any) => shops.has(x.seller_id))
    .reduce((sum: number, x: any) => sum + x.delivery_kobo, 0);
  const total = goods + delivery;
  const limit = plan?.budget?.budget_kobo ?? 0;
  const over = limit ? total - limit : 0;
  // When over budget: the dearest items you could take off, biggest saving first.
  const trims = over > 0 ? [...chosen].sort((a, b) => lineOf(b) - lineOf(a)).slice(0, 3) : [];
  const fits = plan?.budget?.fits_servings;
  const options = slots();
  const blocked = !chosen.length
    ? notFound.length
      ? 'None of these are sold by shops within 15 km yet. Ask sellers or a rider below.'
      : 'Everything is removed. Add something back to order.'
    : !when
      ? 'Pick when it should arrive.'
      : address.trim().length < 8
        ? 'Add the address for the rider.'
        : '';
  // One request per missing item (up to 5), so each reaches the sellers of that thing; if
  // nobody close sells it, the request goes further, and sellers who list it later are told.
  const askSellers = () =>
    void run(async () => {
      for (const i of notFound.slice(0, 5))
        await request('post', '/product-requests', {
          body: {
            text: i.name.slice(0, 200),
            ...(i.needed_quantity >= 1 ? { quantity: i.needed_quantity, unit: i.needed_unit } : {}),
            ...(plan.recipes.length
              ? { details: `For ${plan.recipes[0].name.toLowerCase()}` }
              : {}),
            latitude: point!.latitude,
            longitude: point!.longitude,
            radius_km: 15,
            ...(when ? { needed_by: when.slice(0, 10) } : {}),
          } as any,
        });
      setAsked(true);
    }, 'Sent. Sellers will quote; quotes show in Account → Price alerts & requests.');
  const row = (i: any) => {
    const need = marketMeasure(i.name, i.needed_quantity, i.needed_unit);
    const q = amountOf(i);
    const part = q < 1;
    const out = !!skip[i.key];
    return (
      <View key={i.key} style={[styles.row, out && { opacity: 0.6 }]}>
        {i.listing?.image_url ? (
          <Image source={{ uri: i.listing.image_url }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.noPhoto]}>
            <Text>{i.listing ? '🛍️' : '🔎'}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[s.bold, out && { textDecorationLine: 'line-through' }]}>{i.name}</Text>
          <Text style={s.small}>
            Need {need.label}
            {need.note ? ` (${need.note})` : ''} · {i.from}
          </Text>
          {i.diet && (
            <Text style={i.diet.status === 'AVOID' ? styles.avoid : styles.caution}>
              {i.diet.status === 'AVOID' ? '🚫' : '⚠️'} {i.diet.reason}
            </Text>
          )}
          {i.listing ? (
            <Text style={s.small}>
              {i.listing.title} · {money(i.listing.price_kobo)}/{i.listing.unit} ·{' '}
              {i.listing.business_name}
              {i.oversized
                ? ' · big pack'
                : i.unit_differs && !i.similar
                  ? ' · check the size'
                  : ''}
              {part ? ` · you pay for ${q} ${i.listing.unit}` : ''}
            </Text>
          ) : (
            i.diet?.status !== 'AVOID' && <Text style={s.fine}>Not sold by shops near you yet</Text>
          )}
          {!out && i.similar && (
            <Text style={styles.caution}>
              ≈ Closest match nearby, not exactly “{i.name}”. Check it’s what you want, or remove
              it.
            </Text>
          )}
          {!out && i.oversized && (
            <Text style={s.fine}>Only sold nearby as a big pack, more than this needs.</Text>
          )}
          {!out && !!i.extra_trip_kobo && (
            <Text style={s.fine}>
              Only this shop has it, so it adds a rider trip (about {money(i.extra_trip_kobo)}).
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {i.listing && !out && (
            <View style={styles.stepper}>
              <Pressable
                accessibilityLabel={`Less ${i.name}`}
                onPress={() => {
                  const next = { ...qty };
                  // From one whole unit, step back down to the portion the recipe needs.
                  if (q === 1 && i.portion) delete next[i.key];
                  else if (!part) next[i.key] = Math.max(1, q - 1);
                  setQty(next);
                }}
              >
                <Text style={styles.step}>−</Text>
              </Pressable>
              <Text style={s.bold}>{part ? `${q} ${i.listing.unit}` : q}</Text>
              <Pressable
                accessibilityLabel={`More ${i.name}`}
                onPress={() => setQty({ ...qty, [i.key]: part ? 1 : q + 1 })}
              >
                <Text style={styles.step}>+</Text>
              </Pressable>
            </View>
          )}
          {i.listing && !out && <Text style={s.bold}>{money(lineOf(i))}</Text>}
          <Pressable
            accessibilityRole="button"
            onPress={() => setSkip({ ...skip, [i.key]: !out })}
            style={[styles.remove, out && styles.addBack]}
          >
            <Text style={[styles.removeText, out && { color: '#1f754a' }]}>
              {out ? '＋ Add back' : '✕ Remove'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>🛵 Buy it & bring it</Text>
      <View style={styles.how}>
        {[
          ['1', 'Say what you need: a meal or any list'],
          ['2', 'Remove what you have'],
          ['3', 'Rider brings it · pay on arrival'],
        ].map(([n, label]) => (
          <View key={n} style={styles.howStep}>
            <Text style={styles.howNum}>{n}</Text>
            <Text style={styles.howText}>{label}</Text>
          </View>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setPlan(null);
        }}
        placeholder="Ogbono soup for 2 · or a list: diapers size 3, 2 tins of milk, toothpaste"
        placeholderTextColor="#8aa698"
        multiline
        accessibilityLabel="What do you want"
      />
      {!plan && (
        <>
          <Text style={s.fine}>A shopping list</Text>
          <View style={s.chipWrap}>
            {LISTS.map(([label, list]) => (
              <Chip key={label} title={label} active={false} onPress={() => setText(list)} />
            ))}
          </View>
          {!!ideas.length && (
            <>
              <Text style={s.fine}>Or a meal to cook</Text>
              <View style={s.chipWrap}>
                {ideas.map((i) => (
                  <Chip
                    key={i.key}
                    title={i.name}
                    active={false}
                    onPress={() => setText(i.prompt)}
                  />
                ))}
              </View>
            </>
          )}
        </>
      )}
      <View style={styles.twoCol}>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field
            label="My budget (₦, optional)"
            value={budget}
            onChangeText={(v: string) => {
              setBudget(v.replace(/[^\d,]/g, ''));
              setPlan(null);
            }}
            keyboardType="number-pad"
            placeholder="e.g. 15,000"
          />
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field
            label="Leave out (allergies, things you don’t want)"
            value={avoid}
            onChangeText={(v: string) => {
              setAvoid(v);
              setPlan(null);
            }}
            placeholder="e.g. crayfish, pepper"
          />
        </View>
      </View>
      <Text style={s.fine}>
        Allergies saved in your Planner diet profile are left out too. Always check labels: brands
        differ.
      </Text>
      <Text style={s.small}>Deliver to</Text>
      <Button
        secondary
        title={point ? '📍 Location set · use my location again' : '📍 Use my location'}
        disabled={busy}
        onPress={() => void run(async () => setPoint(await currentPosition()))}
      />
      <PointFields title="Or pick on the map" value={point} onChange={setPoint} />
      <Field
        label="Address for the rider"
        value={address}
        onChangeText={setAddress}
        placeholder="Office name, street, floor, landmark"
      />
      {!plan ? (
        <>
          <Button
            title="Find it nearby"
            disabled={busy || text.trim().length < 2 || !point}
            onPress={() => find()}
          />
          {!point && <Text style={s.fine}>Set the delivery location first.</Text>}
        </>
      ) : (
        <View style={{ gap: 8 }}>
          {!!plan.recipes.length && (
            <Text style={s.small}>
              🍲 {plan.recipes.map((r: any) => r.name).join(', ')} for {plan.servings}. Remove
              anything you already have.
            </Text>
          )}
          {kept.map(row)}
          {!!removed.length && (
            <>
              <Text style={s.fine}>Removed ({removed.length})</Text>
              {removed.map(row)}
            </>
          )}
          <View style={styles.totals}>
            <Text style={s.small}>
              {shops.size} shop{shops.size === 1 ? '' : 's'} · goods {money(goods)} · delivery{' '}
              {money(delivery)}
            </Text>
            <Text style={styles.total}>About {money(total)}</Text>
            {shops.size > 1 && (
              <Text style={s.fine}>
                🛵 One rider collects from all {shops.size} shops on one trip, so each extra shop
                costs only a small stop fee.
              </Text>
            )}
            {!!limit && (
              <>
                <View style={styles.bar}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.min(100, (total / limit) * 100)}%`,
                        backgroundColor: over > 0 ? '#c0392b' : '#1f754a',
                      },
                    ]}
                  />
                </View>
                <Text style={[s.small, over > 0 && { color: '#c0392b', fontWeight: '700' }]}>
                  {over > 0
                    ? `${money(over)} over your ${money(limit)} budget`
                    : `${money(limit - total)} left of your ${money(limit)} budget`}
                  {plan.budget.cheaper_swaps
                    ? ` · we picked ${plan.budget.cheaper_swaps} cheaper option${plan.budget.cheaper_swaps === 1 ? '' : 's'}`
                    : ''}
                </Text>
                {over > 0 && delivery >= limit && (
                  <Text style={s.fine}>
                    Delivery from {shops.size} shop{shops.size === 1 ? '' : 's'} is already{' '}
                    {money(delivery)}. Remove items from the farther shops, or raise the budget.
                  </Text>
                )}
                {over > 0 && (
                  <View style={s.chipWrap}>
                    {trims.map((i) => (
                      <Chip
                        key={i.key}
                        title={`Remove ${i.name} (−${money(lineOf(i))})`}
                        active={false}
                        onPress={() => setSkip({ ...skip, [i.key]: true })}
                      />
                    ))}
                    {!!fits && fits < plan.servings && (
                      <Chip
                        title={`Make it for ${fits} instead`}
                        active={false}
                        onPress={() => find(fits)}
                      />
                    )}
                  </View>
                )}
              </>
            )}
          </View>
          {!!notFound.length && (
            <View style={styles.missing}>
              <Text style={s.bold}>
                🔎 {notFound.length} item{notFound.length === 1 ? '' : 's'} not sold nearby yet
              </Text>
              <Text style={s.small}>{notFound.map((i) => i.name).join(', ')}</Text>
              {asked ? (
                <Text style={s.small}>
                  ✅ Sent. If nobody close sells them, we ask further away, and tell you when a
                  seller lists them. Quotes come to Account.
                </Text>
              ) : (
                <Button
                  secondary
                  title="📣 Ask sellers for these"
                  disabled={busy}
                  onPress={askSellers}
                />
              )}
              {featureOn(settings, 'shopping') && (
                <Pressable onPress={() => setTab('Riders')}>
                  <Text style={s.link}>🛵 Or have a rider buy them at the market ›</Text>
                </Pressable>
              )}
            </View>
          )}
          <Text style={s.small}>When should it arrive?</Text>
          {[
            'Today',
            'Tomorrow',
            ...new Set(options.map((o) => o.day).filter((d) => !['Today', 'Tomorrow'].includes(d))),
          ]
            .filter((d) => options.some((o) => o.day === d))
            .map((d) => (
              <View key={d} style={{ gap: 4 }}>
                <Text style={s.fine}>{d}</Text>
                <View style={s.chipWrap}>
                  {options
                    .filter((o) => o.day === d)
                    .map((o) => (
                      <Chip
                        key={o.iso}
                        title={o.label}
                        active={when === o.iso}
                        onPress={() => setWhen(o.iso)}
                      />
                    ))}
                </View>
              </View>
            ))}
          <Field
            label="Note for the shops (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Big fresh ugu, please"
          />
          <Button
            title={`Order ${chosen.length} item${chosen.length === 1 ? '' : 's'} · pay on delivery${when ? ` · ${options.find((o) => o.iso === when)?.day} ${options.find((o) => o.iso === when)?.label}` : ''}`}
            disabled={busy || !!blocked}
            onPress={() =>
              void run(async () =>
                setPlaced(
                  await request('post', '/errands', {
                    body: {
                      text: text.trim(),
                      servings: plan.servings,
                      dropoff: point!,
                      dropoff_address: address.trim(),
                      deliver_at: when!,
                      ...(note ? { note } : {}),
                      items: chosen.map((i: any) => ({
                        listing_id: i.listing.id,
                        variant_id: i.listing.variant_id,
                        quantity: amountOf(i) < 1 ? 1 : amountOf(i),
                        ...(amountOf(i) < 1 ? { portion: amountOf(i) } : {}),
                        needed: marketMeasure(i.name, i.needed_quantity, i.needed_unit).label,
                      })),
                    },
                  }),
                ),
              )
            }
          />
          {!!blocked && <Text style={styles.blocked}>{blocked}</Text>}
          <Pressable onPress={() => setPlan(null)}>
            <Text style={s.link}>Change what I asked for</Text>
          </Pressable>
        </View>
      )}
      <Pressable onPress={() => (onClose ? onClose() : setOpen(false))}>
        <Text style={s.link}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  teaser: { padding: 16, borderRadius: 16, backgroundColor: '#1f754a', gap: 6 },
  teaserTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  teaserText: { color: '#e4f8ee', fontSize: 13, lineHeight: 19 },
  input: {
    padding: 12,
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 10,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e1efe7',
  },
  noPhoto: { backgroundColor: '#eef6f1', alignItems: 'center', justifyContent: 'center' },
  remove: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#fbebeb',
  },
  addBack: { backgroundColor: '#e5f4e4' },
  removeText: { fontSize: 12, fontWeight: '800', color: '#a83224' },
  avoid: { fontSize: 11, fontWeight: '700', color: '#a83224' },
  caution: { fontSize: 11, fontWeight: '700', color: '#8a5a00' },
  how: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  howStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#e5f4e4',
  },
  howNum: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1f754a',
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 18,
    overflow: 'hidden',
  },
  howText: { fontSize: 11, fontWeight: '700', color: '#1c4b34' },
  twoCol: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  totals: { gap: 4, padding: 10, borderRadius: 12, backgroundColor: '#f4faf6' },
  total: { fontSize: 18, fontWeight: '800', color: '#16402b' },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#dcebe2', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  missing: {
    gap: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff8e8',
    borderWidth: 1,
    borderColor: '#f3dca0',
  },
  blocked: { fontSize: 12, color: '#a83224', fontWeight: '700', textAlign: 'center' },
  photo: { width: 44, height: 44, borderRadius: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { fontSize: 22, fontWeight: '800', color: '#1f754a', paddingHorizontal: 6 },
});
