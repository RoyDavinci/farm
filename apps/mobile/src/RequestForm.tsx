import { money, type Listing } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { featureOn } from './features';
import { currentPosition } from './location';
import { request } from './request';
import { PointFields } from './RiderPicker';
import { Button, Chip, Field, s } from './ui';

const FOOD = ['Food & groceries', 'Vegetables', 'Fruit', 'Grains', 'Tubers', 'Livestock'];
const FOOD_UNITS = ['kg', 'bags', 'crates', 'baskets', 'cartons', 'pieces', 'litres', 'tubers'];
const GOODS_UNITS = ['pieces', 'pairs', 'sets', 'packs', 'boxes', 'cartons'];
/** Ideas that show the range of things people can ask for. */
const IDEAS = [
  'iPhone 13, 128GB',
  'Size 42 sneakers',
  'Car battery for Corolla 2010',
  '3-seater sofa',
  'Baby stroller',
  'Bag of rice (50kg)',
  'Gas cylinder refill',
  'Office chair',
];
const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/**
 * "Ask for anything": what (and the details that matter: brand, model, size, colour, new or
 * used), how many, budget, by when and where. Products already on Ahia show as you type, so you
 * can buy straight away; otherwise sellers who sell it are alerted (further away if nobody close
 * does) and quote, and sellers who list it during the week are alerted too.
 */
export default function RequestForm({
  initialText = '',
  onDone,
}: {
  initialText?: string;
  onDone?: () => void;
}) {
  const { busy, run, settings, openListing, setTab } = useApp();
  const categories: string[] = settings?.catalog?.categories || [];
  const [text, setText] = useState(initialText),
    [category, setCategory] = useState(''),
    [details, setDetails] = useState(''),
    [condition, setCondition] = useState<'' | 'NEW' | 'USED'>(''),
    [qty, setQty] = useState(''),
    [unit, setUnit] = useState('pieces'),
    [budget, setBudget] = useState(''),
    [neededBy, setNeededBy] = useState<string | null>(null),
    [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null),
    [area, setArea] = useState(''),
    [radius, setRadius] = useState<number | 'anywhere'>(10),
    [matches, setMatches] = useState<Listing[]>([]),
    [similar, setSimilar] = useState(false),
    [sent, setSent] = useState<any>(null);
  const food = FOOD.includes(category);
  const units = food ? FOOD_UNITS : GOODS_UNITS;
  useEffect(() => {
    if (!units.includes(unit)) setUnit(units[0]);
  }, [food]);
  // What's already for sale: shown as they type, so they can buy it now instead of waiting.
  useEffect(() => {
    // "iPhone 13, 128GB" → look up "iPhone 13"; the rest is detail.
    const q = text.split(/[,(]/)[0].trim();
    if (q.length < 3) {
      setMatches([]);
      return;
    }
    let current = true;
    const look = (term: string) =>
      request('get', '/search', {
        query: {
          q: term,
          limit: '4',
          ...(category ? { category } : {}),
          ...(point
            ? { lat: String(point.latitude), lng: String(point.longitude), radius_km: '50' }
            : {}),
        } as any,
      })
        .then((r: any) => (r.items ?? []).slice(0, 4) as Listing[])
        .catch(() => [] as Listing[]);
    const t = setTimeout(async () => {
      let found = await look(q);
      let similar = false;
      // Nothing by that exact name: try its main word ("iPhone 13" → "iPhone").
      const main = q
        .split(/\s+/)
        .filter((w) => /[a-z]{3,}/i.test(w))
        .sort((a, b) => b.length - a.length)[0];
      if (!found.length && main && main.toLowerCase() !== q.toLowerCase()) {
        found = await look(main);
        similar = found.length > 0;
      }
      if (current) {
        setMatches(found);
        setSimilar(similar);
      }
    }, 400);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [text, category, point]);

  const send = (anywhere: boolean) =>
    run(async () =>
      setSent(
        await request('post', '/product-requests', {
          body: {
            text: text.trim(),
            ...(details.trim() ? { details: details.trim() } : {}),
            ...(condition ? { condition } : {}),
            ...(category ? { category } : {}),
            ...(Number(qty) > 0 ? { quantity: Number(qty), unit } : {}),
            ...(Number(budget) > 0 ? { budget_kobo: Math.round(Number(budget) * 100) } : {}),
            ...(neededBy ? { needed_by: neededBy } : {}),
            ...(point ? { latitude: point.latitude, longitude: point.longitude } : {}),
            ...(area.trim() ? { area: area.trim() } : {}),
            radius_km: radius === 'anywhere' ? 50 : radius,
            anywhere,
          } as any,
        }),
      ),
    );

  if (sent) {
    const n = sent.sellers.length;
    return (
      <View style={s.locationBox}>
        <Text style={s.bold}>{n ? '✅ Request sent' : '📣 Request posted'}</Text>
        <Text style={s.small}>
          {n
            ? `We alerted ${n} seller${n === 1 ? '' : 's'}${
                sent.reach_km == null
                  ? ' across Nigeria'
                  : area
                    ? ` within ${sent.reach_km} km of ${area}`
                    : ` within ${sent.reach_km} km`
              }. Quotes show in Account → Price alerts & requests.`
            : 'No seller has this listed yet. Your request stays open for 7 days: any seller who lists it is alerted, and we tell you as soon as it’s on Ahia.'}
        </Text>
        {sent.widened && n > 0 && (
          <Text style={s.fine}>
            Nobody close by sells it, so we looked further to find someone who can help.
          </Text>
        )}
        {sent.sellers.slice(0, 5).map((x: any) => (
          <Text key={x.seller_id} style={s.small}>
            • {x.verified ? '✅ ' : ''}
            {x.business_name} · {x.reason}
          </Text>
        ))}
        {!n && (
          <View style={{ gap: 8 }}>
            {sent.reach_km != null && (
              <Button
                secondary
                title="Ask sellers across Nigeria"
                disabled={busy}
                onPress={() => void send(true)}
              />
            )}
            {featureOn(settings, 'shopping') && (
              <Button
                secondary
                title="🛵 Have a rider find and buy it"
                onPress={() => {
                  onDone?.();
                  setTab('Riders');
                }}
              />
            )}
          </View>
        )}
        <Pressable onPress={onDone}>
          <Text style={s.link}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>🙋 Ask for anything</Text>
      <Text style={s.small}>
        Can’t find it? Phones, clothes, food, car parts, furniture, baby things: tell sellers what
        you want. They quote, you choose.
      </Text>
      <Field
        label="What do you need?"
        value={text}
        onChangeText={setText}
        placeholder="e.g. iPhone 13, size 42 sneakers, 50kg rice"
      />
      {!text.trim() && (
        <View style={s.chipWrap}>
          {IDEAS.map((idea) => (
            <Chip key={idea} title={idea} active={false} onPress={() => setText(idea)} />
          ))}
        </View>
      )}
      {matches.length > 0 && (
        <View style={styles.matches}>
          <Text style={s.bold}>{similar ? 'Similar on Ahia' : 'Already on Ahia'}</Text>
          {matches.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              style={styles.match}
              onPress={() => openListing(l)}
            >
              {l.image_url ? (
                <Image
                  source={{ uri: (l as any).thumbnail_url || l.image_url }}
                  style={styles.matchPhoto}
                />
              ) : (
                <View style={[styles.matchPhoto, styles.matchEmpty]}>
                  <Text>🛍️</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.bold} numberOfLines={1}>
                  {l.title}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {money(l.price_kobo)}/{l.unit} · {(l as any).business_name}
                </Text>
              </View>
              <Text style={styles.matchGo}>View ›</Text>
            </Pressable>
          ))}
          <Text style={s.fine}>Not quite it? Keep going and sellers will quote for you.</Text>
        </View>
      )}
      {categories.length > 0 && (
        <>
          <Text style={s.small}>What kind of thing is it? (helps us reach the right sellers)</Text>
          <View style={s.chipWrap}>
            <Chip title="Not sure" active={!category} onPress={() => setCategory('')} />
            {categories.map((c) => (
              <Chip key={c} title={c} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
        </>
      )}
      <Field
        label="Details (optional)"
        value={details}
        onChangeText={setDetails}
        multiline
        placeholder={
          food
            ? 'Variety, size, how fresh, brand…'
            : 'Brand, model, size, colour, storage… anything that matters'
        }
      />
      {!food && (
        <>
          <Text style={s.small}>Condition</Text>
          <View style={s.chipWrap}>
            {(
              [
                ['', 'Any'],
                ['NEW', 'New only'],
                ['USED', 'Used is fine'],
              ] as const
            ).map(([v, label]) => (
              <Chip
                key={label}
                title={label}
                active={condition === v}
                onPress={() => setCondition(v)}
              />
            ))}
          </View>
        </>
      )}
      <Field
        label="How many?"
        value={qty}
        keyboardType="decimal-pad"
        onChangeText={(v: string) => setQty(v.replace(/[^0-9.]/g, ''))}
        placeholder="e.g. 1"
      />
      <View style={s.chipWrap}>
        {units.map((u) => (
          <Chip key={u} title={u} active={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>
      <Field
        label="Budget (₦, optional)"
        value={budget}
        keyboardType="number-pad"
        onChangeText={(v: string) => setBudget(v.replace(/[^0-9]/g, ''))}
      />
      <Text style={s.small}>Needed by</Text>
      <View style={s.chipWrap}>
        {[
          ['Any time', null],
          ['Today', day(0)],
          ['Tomorrow', day(1)],
          ['This week', day(6)],
        ].map(([label, value]) => (
          <Chip
            key={String(label)}
            title={String(label)}
            active={neededBy === value}
            onPress={() => setNeededBy(value)}
          />
        ))}
      </View>
      <Text style={s.small}>Where are you? Sellers around you are asked first.</Text>
      <Button
        secondary
        title={point ? '📍 Location set · use my location again' : '📍 Use my location'}
        disabled={busy}
        onPress={() => void run(async () => setPoint(await currentPosition()))}
      />
      <PointFields title="Or pick on the map" value={point} onChange={setPoint} />
      <Field
        label="Area name (shown to sellers)"
        value={area}
        onChangeText={setArea}
        placeholder="e.g. Ikeja, Lekki, Wuse 2"
      />
      <View style={s.chipWrap}>
        {[5, 10, 20, 50].map((r) => (
          <Chip
            key={r}
            title={`Within ${r} km`}
            active={radius === r}
            onPress={() => setRadius(r)}
          />
        ))}
        <Chip
          title="Anywhere in Nigeria"
          active={radius === 'anywhere'}
          onPress={() => setRadius('anywhere')}
        />
      </View>
      <Text style={s.fine}>
        If nobody close sells it, we look further so your request still reaches someone.
      </Text>
      <Button
        title="Send to sellers"
        disabled={busy || text.trim().length < 2 || (!point && radius !== 'anywhere')}
        onPress={() => void send(radius === 'anywhere')}
      />
      {text.trim().length < 2 ? (
        <Text style={s.fine}>Say what you need to send the request.</Text>
      ) : (
        !point &&
        radius !== 'anywhere' && (
          <Text style={s.fine}>Set your location, or choose “Anywhere in Nigeria”.</Text>
        )
      )}
      {Number(budget) > 0 && Number(qty) > 1 && (
        <Text style={s.fine}>
          About {money(Math.round((Number(budget) * 100) / Number(qty)))} per{' '}
          {unit.replace(/(es|s)$/, '')}.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  matches: {
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d9ebe2',
  },
  match: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  matchPhoto: { width: 44, height: 44, borderRadius: 10 },
  matchEmpty: { backgroundColor: '#eef6f1', alignItems: 'center', justifyContent: 'center' },
  matchGo: { color: '#1f754a', fontWeight: '800' },
});
