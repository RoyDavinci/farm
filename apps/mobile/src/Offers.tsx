import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { shareOnWhatsApp } from './share';
import { Button, Chip, Field, s } from './ui';

const openById = async (openListing: (l: any) => void, id: string) =>
  openListing((await request('get', '/listings/{id}', { params: { id } })) as any);

/** Home: genuine offers in four rails (today, this week, fresh produce, wholesale). */
export function OffersPanel() {
  const { openListing, run } = useApp();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    void request('get', '/offers')
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return null;
  const rails: [string, string, any[]][] = [
    ['⏰ Today only', 'Ends at midnight', data.today],
    ['📅 This week', 'Weekly offers', data.week],
    ['🥬 Fresh produce offers', 'From the market', data.fresh],
    ['📦 Wholesale discounts', 'Buy more, pay less', data.wholesale],
  ];
  if (rails.every(([, , items]) => !items.length)) return null;
  return (
    <View style={{ gap: 12 }}>
      {rails
        .filter(([, , items]) => items.length)
        .map(([title, sub, items]) => (
          <View key={title} style={{ gap: 8 }}>
            <View style={s.rowBetween}>
              <Text style={s.sectionTitle}>{title}</Text>
              <Text style={s.small}>{sub}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }}
            >
              {items.map((o: any) => (
                <Pressable
                  key={`${title}-${o.id}`}
                  accessibilityRole="button"
                  onPress={() => void run(() => openById(openListing, o.id))}
                  style={styles.card}
                >
                  {o.image_url ? (
                    <Image source={{ uri: o.image_url }} style={styles.photo} />
                  ) : (
                    <View style={[styles.photo, styles.noPhoto]}>
                      <Text style={{ fontSize: 28 }}>🛍️</Text>
                    </View>
                  )}
                  <Text style={styles.badge}>−{o.off_pct}%</Text>
                  <Text numberOfLines={2} style={s.bold}>
                    {o.title}
                  </Text>
                  {o.min_quantity ? (
                    <Text style={s.small}>
                      {money(o.tier_price_kobo)} each for {o.min_quantity}+ (usually{' '}
                      {money(o.price_kobo)})
                    </Text>
                  ) : (
                    <Text style={s.small}>
                      <Text style={s.bold}>{money(o.price_kobo)}</Text>{' '}
                      <Text style={{ textDecorationLine: 'line-through' }}>
                        {money(o.was_price_kobo)}
                      </Text>
                      {o.left != null ? ` · ${o.left} left` : ''}
                    </Text>
                  )}
                  <Text numberOfLines={1} style={s.small}>
                    {o.verified ? '✅ ' : ''}
                    {o.business_name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ))}
      <Text style={s.fine}>
        Genuine offers only: the old price is one the seller really charged for at least a week, and
        each deal shows how many are left.
      </Text>
    </View>
  );
}

/** One group buy: who's in, share price, join / invite / leave. */
export function GroupCard({ g, onChanged }: { g: any; onChanged: () => void }) {
  const { busy, run } = useApp();
  const [inviting, setInviting] = useState(false),
    [contact, setContact] = useState('');
  return (
    <View style={styles.group}>
      <View style={s.rowBetween}>
        <Text style={[s.bold, { flex: 1 }]}>👥 {g.title}</Text>
        <Text style={styles.badge}>−{g.discount_pct}%</Text>
      </View>
      <Text style={s.small}>
        {g.quantity > 1 ? `${g.quantity} ${g.unit} · ` : ''}
        {money(g.share_price_kobo)} a share (whole {money(g.full_price_kobo)}) · {g.business_name},{' '}
        {g.area}
      </Text>
      <Text style={s.small}>
        {g.status === 'OPEN'
          ? `${g.taken} of ${g.shares} shares taken · closes ${new Date(g.expires_at).toLocaleString()}`
          : g.status === 'ORDERED'
            ? `Full! Order with the seller (${String(g.booking_status || '')
                .toLowerCase()
                .replaceAll('_', ' ')}).`
            : g.status.toLowerCase()}
      </Text>
      <Text style={s.small}>
        In: {g.members.map((m: any) => (m.you ? 'you' : m.name)).join(', ')}
      </Text>
      {g.note && <Text style={s.small}>“{g.note}”</Text>}
      {g.is_creator && g.status === 'ORDERED' && (
        <Text style={s.small}>
          You collect for the group{g.pickup_code ? ` · pickup code ${g.pickup_code}` : ''}.
        </Text>
      )}
      {g.status === 'OPEN' && !g.joined && (
        <Button
          title={`Join · pay ${money(g.share_price_kobo)}`}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await request('post', '/group-buys/{id}/join', { params: { id: g.id }, body: {} });
              onChanged();
            }, 'You’re in. Your share is held safely until the group fills.')
          }
        />
      )}
      {g.status === 'OPEN' && g.joined && (
        <View style={s.chipWrap}>
          <Chip title="Invite someone" active={inviting} onPress={() => setInviting(!inviting)} />
          <Chip
            title="Share on WhatsApp"
            active={false}
            onPress={() =>
              void shareOnWhatsApp(
                `Let's share ${g.title} on Ahia: ${money(g.share_price_kobo)} each, ${g.spots_left} share${g.spots_left === 1 ? '' : 's'} left. Open Ahia → Home → Group buys to join.`,
              )
            }
          />
          <Chip
            title={g.is_creator ? 'Cancel group' : 'Leave'}
            active={false}
            onPress={() =>
              void run(async () => {
                await request('post', '/group-buys/{id}/leave', { params: { id: g.id }, body: {} });
                onChanged();
              }, 'Your share was refunded.')
            }
          />
        </View>
      )}
      {inviting && (
        <View style={{ gap: 6 }}>
          <Field
            label="Their email or phone (Ahia account)"
            value={contact}
            onChangeText={setContact}
          />
          <Button
            secondary
            title="Send invite"
            disabled={busy || contact.trim().length < 5}
            onPress={() =>
              void run(async () => {
                await request('post', '/group-buys/{id}/invite', {
                  params: { id: g.id },
                  body: { contact: contact.trim() },
                });
                setContact('');
                setInviting(false);
              }, 'Invite sent.')
            }
          />
        </View>
      )}
    </View>
  );
}

/** Home: group buys to join (invited and suggested first) and the user's own groups. */
export function GroupBuysPanel({ query }: { query?: string }) {
  const [data, setData] = useState<{ open: any[]; mine: any[] } | null>(null);
  const load = useCallback(
    () =>
      request('get', '/group-buys', { query: (query ? { q: query } : {}) as any })
        .then((d) => setData(d as any))
        .catch(() => setData(null)),
    [query],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || (!data.open.length && !data.mine.length)) return null;
  const live = data.mine.filter((g) => ['OPEN', 'ORDERED'].includes(g.status));
  return (
    <View style={{ gap: 10 }}>
      <View style={s.rowBetween}>
        <Text style={s.sectionTitle}>👥 Group buys</Text>
        <Text style={s.small}>Share it, save 1–3%</Text>
      </View>
      {live.map((g) => (
        <GroupCard key={g.id} g={g} onChanged={() => void load()} />
      ))}
      {data.open.slice(0, 5).map((g) => (
        <GroupCard key={g.id} g={g} onChanged={() => void load()} />
      ))}
    </View>
  );
}

/** Product page: join a group for this product, or start one. */
export function GroupBuyForListing({ listing }: { listing: any }) {
  const { busy, run } = useApp();
  const [groups, setGroups] = useState<any[]>([]),
    [starting, setStarting] = useState(false),
    [shares, setShares] = useState(2),
    [quantity, setQuantity] = useState(1),
    [note, setNote] = useState('');
  const load = useCallback(
    () =>
      request('get', '/group-buys', { query: { listing_id: listing.id } as any })
        .then((d: any) =>
          setGroups([
            ...d.mine.filter((g: any) => g.listing_id === listing.id && g.status === 'OPEN'),
            ...d.open,
          ]),
        )
        .catch(() => setGroups([])),
    [listing.id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const pct = shares >= 4 ? 3 : shares === 3 ? 2 : 1;
  const estimate = Math.ceil((listing.price_kobo * quantity * (100 - pct)) / 100 / shares);
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>👥 Buy it with others</Text>
      <Text style={s.small}>
        Share one purchase, like a goat or a bag of rice. Everyone pays their share, held safely
        until the group fills; Ahia takes 1–3% off.
      </Text>
      {groups.map((g) => (
        <GroupCard key={g.id} g={g} onChanged={() => void load()} />
      ))}
      {starting ? (
        <View style={{ gap: 8 }}>
          <Text style={s.small}>How many people share it?</Text>
          <View style={s.chipWrap}>
            {[2, 3, 4, 5, 6].map((n) => (
              <Chip
                key={n}
                title={`${n} people`}
                active={shares === n}
                onPress={() => setShares(n)}
              />
            ))}
          </View>
          <Text style={s.small}>How many {listing.unit} in total?</Text>
          <View style={s.chipWrap}>
            {[1, 2, 3, 5, 10].map((n) => (
              <Chip
                key={n}
                title={String(n)}
                active={quantity === n}
                onPress={() => setQuantity(n)}
              />
            ))}
          </View>
          <Field
            label="Note for others (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Sharing for Sallah, Ikeja"
          />
          <Button
            title={`Start · pay my share (about ${money(estimate)}, ${pct}% off)`}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await request('post', '/group-buys', {
                  body: { listing_id: listing.id, shares, quantity, ...(note ? { note } : {}) },
                });
                setStarting(false);
                await load();
              }, 'Group started. People looking for this have been told.')
            }
          />
        </View>
      ) : (
        <Button secondary title="Start a group buy" onPress={() => setStarting(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    padding: 12,
    paddingRight: 40,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 10,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  clear: { position: 'absolute', right: 12, top: 10, padding: 2 },
  dropdown: {
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  optionLine: { borderTopWidth: 1, borderTopColor: '#eef4f0' },
  optionPhoto: { width: 44, height: 44, borderRadius: 8 },
  openBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6a3d9a',
    backgroundColor: '#efedff',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  card: {
    width: 170,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e1efe7',
    gap: 4,
  },
  photo: { width: '100%', height: 100, borderRadius: 10 },
  noPhoto: { backgroundColor: '#eef6f1', alignItems: 'center', justifyContent: 'center' },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#c0392b',
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  group: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e1efe7',
    gap: 6,
  },
});

const GROUP_IDEAS = [
  'Goat',
  'Bag of rice',
  'Crate of eggs',
  'Cow meat',
  'Carton of fish',
  'Tuber of yam',
];

/**
 * Home → Group buys: search for what you want to share; matching products come up in a
 * dropdown with the best sellers first (verified, well rated, reliable, nearby). Pick one to
 * join an open group for it or start one. Open groups matching the search show below.
 */
export function GroupFinder({ point }: { point?: { latitude: number; longitude: number } | null }) {
  const [q, setQ] = useState(''),
    [results, setResults] = useState<any[] | null>(null),
    [searching, setSearching] = useState(false),
    [picked, setPicked] = useState<any>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || picked) {
      setResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void request('get', '/group-buys/search', {
        query: {
          q: term,
          ...(point ? { lat: point.latitude, lng: point.longitude } : {}),
        } as any,
      })
        .then((r) => setResults(r as any[]))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [q, point, picked]);
  return (
    <View style={{ gap: 10 }}>
      <View style={s.locationBox}>
        <Text style={s.bold}>👥 What do you want to buy together?</Text>
        <Text style={s.small}>
          Search, pick a good seller, then start a group or join one. Everyone pays their share,
          held safely until the group fills; Ahia takes 1–3% off.
        </Text>
        <View>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={(v) => {
              setQ(v);
              setPicked(null);
            }}
            placeholder="e.g. goat, bag of rice, crate of eggs"
            placeholderTextColor="#8aa698"
            accessibilityLabel="Search for something to buy together"
          />
          {!!q && (
            <Pressable
              accessibilityLabel="Clear search"
              onPress={() => {
                setQ('');
                setPicked(null);
              }}
              style={styles.clear}
            >
              <Text style={{ color: '#5e8270', fontSize: 16 }}>✕</Text>
            </Pressable>
          )}
        </View>
        {!q && (
          <View style={s.chipWrap}>
            {GROUP_IDEAS.map((x) => (
              <Chip key={x} title={x} active={false} onPress={() => setQ(x)} />
            ))}
          </View>
        )}
        {!picked && q.trim().length >= 2 && (
          <View style={styles.dropdown}>
            {searching && !results ? (
              <Text style={[s.small, { padding: 10 }]}>Looking for sellers…</Text>
            ) : !results?.length ? (
              <Text style={[s.small, { padding: 10 }]}>
                No sellers have “{q.trim()}” yet. Try another word, or ask sellers from Home →
                Request it.
              </Text>
            ) : (
              results.map((r, i) => (
                <Pressable
                  key={r.listing_id}
                  accessibilityRole="button"
                  onPress={() => setPicked(r)}
                  style={[styles.option, i > 0 && styles.optionLine]}
                >
                  {r.image_url ? (
                    <Image source={{ uri: r.image_url }} style={styles.optionPhoto} />
                  ) : (
                    <View style={[styles.optionPhoto, styles.noPhoto]}>
                      <Text>🛍️</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={s.bold} numberOfLines={1}>
                      {r.title}
                    </Text>
                    <Text style={s.small} numberOfLines={1}>
                      {money(r.price_kobo)}/{r.unit} · {r.verified ? '✅ ' : ''}
                      {r.business_name}
                      {r.area ? `, ${r.area}` : ''}
                    </Text>
                    <Text style={s.fine} numberOfLines={1}>
                      {i === 0 ? '⭐ Best match · ' : ''}
                      {r.reason}
                    </Text>
                  </View>
                  {r.open_groups > 0 && (
                    <Text style={styles.openBadge}>
                      {r.open_groups} group{r.open_groups === 1 ? '' : 's'} open
                    </Text>
                  )}
                </Pressable>
              ))
            )}
          </View>
        )}
        {picked && (
          <View style={{ gap: 6 }}>
            <View style={s.rowBetween}>
              <Text style={[s.small, { flex: 1 }]}>
                {picked.title} from {picked.verified ? '✅ ' : ''}
                {picked.business_name} · {picked.reason}
              </Text>
              <Pressable onPress={() => setPicked(null)}>
                <Text style={s.link}>Change</Text>
              </Pressable>
            </View>
            <GroupBuyForListing
              listing={{
                id: picked.listing_id,
                title: picked.title,
                unit: picked.unit,
                price_kobo: picked.price_kobo,
              }}
            />
          </View>
        )}
      </View>
      {!picked && <GroupBuysPanel query={q.trim().length >= 2 ? q.trim() : undefined} />}
    </View>
  );
}
