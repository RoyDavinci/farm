import { marketMeasure, money } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
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
 */
export default function ErrandPanel() {
  const { busy, run } = useApp();
  const [text, setText] = useState(''),
    [ideas, setIdeas] = useState<any[]>([]),
    [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null),
    [address, setAddress] = useState(''),
    [plan, setPlan] = useState<any>(null),
    [qty, setQty] = useState<Record<string, number>>({}),
    [skip, setSkip] = useState<Record<string, boolean>>({}),
    [when, setWhen] = useState<string | null>(null),
    [note, setNote] = useState(''),
    [placed, setPlaced] = useState<any>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !ideas.length)
      void request('get', '/errands/ideas')
        .then((r) => setIdeas((r as any[]).slice(0, 8)))
        .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const items = plan?.items ?? [];
  const chosen = items.filter((i: any) => i.listing && !skip[i.key]);
  const goods = chosen.reduce(
    (sum: number, i: any) => sum + i.listing.price_kobo * (qty[i.key] ?? i.quantity),
    0,
  );
  const shops = new Set(chosen.map((i: any) => i.listing.seller_id));
  const delivery = (plan?.sellers ?? [])
    .filter((x: any) => shops.has(x.seller_id))
    .reduce((sum: number, x: any) => sum + x.delivery_kobo, 0);
  const options = slots();
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>🛵 Buy it & bring it</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setPlan(null);
        }}
        placeholder="I want to make egusi for 6 · 2 crates of eggs and 5kg rice"
        placeholderTextColor="#8aa698"
        multiline
        accessibilityLabel="What do you want"
      />
      {!plan && !!ideas.length && (
        <View style={s.chipWrap}>
          {ideas.map((i) => (
            <Chip key={i.key} title={i.name} active={false} onPress={() => setText(i.prompt)} />
          ))}
        </View>
      )}
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
        <Button
          title="Find it nearby"
          disabled={busy || text.trim().length < 2 || !point}
          onPress={() =>
            void run(async () => {
              const p: any = await request('post', '/errands/plan', {
                body: { text: text.trim(), latitude: point!.latitude, longitude: point!.longitude },
              });
              setPlan(p);
              setQty({});
              // Items that would need their own rider trip, or only come in a far bigger pack, start unticked.
              setSkip(
                Object.fromEntries(
                  p.items
                    .filter((i: any) => i.extra_trip_kobo || i.oversized)
                    .map((i: any) => [i.key, true]),
                ),
              );
            })
          }
        />
      ) : (
        <View style={{ gap: 8 }}>
          {!!plan.recipes.length && (
            <Text style={s.small}>
              🍲 {plan.recipes.map((r: any) => r.name).join(', ')} for {plan.servings}. Untick
              anything you already have.
            </Text>
          )}
          {items.map((i: any) => {
            const need = marketMeasure(i.name, i.needed_quantity, i.needed_unit);
            const q = qty[i.key] ?? i.quantity;
            return (
              <View
                key={i.key}
                style={[styles.row, (skip[i.key] || !i.listing) && { opacity: 0.55 }]}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!i.listing && !skip[i.key] }}
                  disabled={!i.listing}
                  onPress={() => setSkip({ ...skip, [i.key]: !skip[i.key] })}
                >
                  <Text style={styles.box}>{!i.listing ? '·' : skip[i.key] ? '☐' : '☑'}</Text>
                </Pressable>
                {i.listing?.image_url ? (
                  <Image source={{ uri: i.listing.image_url }} style={styles.photo} />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={s.bold}>{i.name}</Text>
                  <Text style={s.small}>
                    Need {need.label}
                    {need.note ? ` (${need.note})` : ''} · {i.from}
                  </Text>
                  {i.listing ? (
                    <Text style={s.small}>
                      {i.listing.title} · {money(i.listing.price_kobo)}/{i.listing.unit} ·{' '}
                      {i.listing.business_name}
                      {i.oversized ? ' · big pack' : i.unit_differs ? ' · check the size' : ''}
                    </Text>
                  ) : (
                    <Text style={s.fine}>Not found nearby</Text>
                  )}
                  {i.oversized && (
                    <Text style={s.fine}>
                      Nearby it’s only sold as a big pack, more than this recipe needs. Tick it if
                      you want it anyway.
                    </Text>
                  )}
                  {!!i.extra_trip_kobo && (
                    <Text style={s.fine}>
                      Only this shop has it, so it adds a rider trip (about{' '}
                      {money(i.extra_trip_kobo)}). Tick it if you need it.
                    </Text>
                  )}
                </View>
                {i.listing && !skip[i.key] && (
                  <View style={styles.stepper}>
                    <Pressable onPress={() => setQty({ ...qty, [i.key]: Math.max(1, q - 1) })}>
                      <Text style={styles.step}>−</Text>
                    </Pressable>
                    <Text style={s.bold}>{q}</Text>
                    <Pressable onPress={() => setQty({ ...qty, [i.key]: q + 1 })}>
                      <Text style={styles.step}>+</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
          <Text style={s.small}>
            {shops.size} shop{shops.size === 1 ? '' : 's'} · goods {money(goods)} · delivery about{' '}
            {money(delivery)} · <Text style={s.bold}>about {money(goods + delivery)}</Text>
          </Text>
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
            title={`Order · pay on delivery${when ? ` · ${options.find((o) => o.iso === when)?.day} ${options.find((o) => o.iso === when)?.label}` : ''}`}
            disabled={busy || !chosen.length || !when || address.trim().length < 8}
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
                        quantity: qty[i.key] ?? i.quantity,
                        needed: marketMeasure(i.name, i.needed_quantity, i.needed_unit).label,
                      })),
                    },
                  }),
                ),
              )
            }
          />
          {address.trim().length < 8 && <Text style={s.fine}>Add the address for the rider.</Text>}
          <Pressable onPress={() => setPlan(null)}>
            <Text style={s.link}>Change what I asked for</Text>
          </Pressable>
        </View>
      )}
      <Pressable onPress={() => setOpen(false)}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  box: { fontSize: 20, width: 22, color: '#1f754a' },
  photo: { width: 36, height: 36, borderRadius: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { fontSize: 22, fontWeight: '800', color: '#1f754a', paddingHorizontal: 6 },
});
