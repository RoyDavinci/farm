import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { money, type LocalStatus } from '@zuru/shared';
import { useApp } from './AppContext';
import { currentPosition } from './location';
import { request } from './request';
import StoryViewer from './StoryViewer';
import { Button, Field, s } from './ui';

type Scope = {
  lat?: number;
  lng?: number;
  state?: string;
  lga?: string;
  category?: string;
  city?: string;
};
const SEEN_KEY = 'fm-seen-statuses';

/**
 * Local Status as a stories row at the top of Market: one circle per nearby seller (coloured ring
 * until watched, gold badge when sponsored), "Your status" first for sellers, and boosted posts as
 * cards below. Tapping a circle opens the full-screen viewer at that seller's first story.
 */
export default function LocalStatusFeed({
  point,
  category,
  refreshVersion,
}: {
  point: { latitude: number; longitude: number } | null;
  category: string;
  refreshVersion: number;
}) {
  const { setTab, seller, settings } = useApp();
  const [manual, setManual] = useState(false),
    [state, setState] = useState(''),
    [lga, setLga] = useState(''),
    [areaKind, setAreaKind] = useState<'LGA' | 'CITY'>('LGA'),
    [chosen, setChosen] = useState<Scope>({}),
    [items, setItems] = useState<LocalStatus[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [playlist, setPlaylist] = useState<LocalStatus[]>([]),
    [seen, setSeen] = useState<Set<string>>(new Set()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [showMuted, setShowMuted] = useState(false),
    [mutes, setMutes] = useState<
      { kind: 'SELLER' | 'CATEGORY'; target: string; label?: string | null }[]
    >([]);
  const scope: Scope = chosen.state
    ? { ...chosen, category }
    : { ...(point ? { lat: point.latitude, lng: point.longitude } : chosen), category };
  const scopeKey = JSON.stringify(scope),
    sequence = useRef(0);
  const local = scope.lat !== undefined || !!(scope.state && (scope.lga || scope.city));

  // Remember which stories were watched, so their rings turn grey.
  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => v && setSeen(new Set(JSON.parse(v))))
      .catch(() => {});
  }, []);
  const markSeen = useCallback((id: string) => {
    setSeen((old) => {
      if (old.has(id)) return old;
      const next = new Set(old).add(id);
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-300))).catch(() => {});
      return next;
    });
  }, []);

  // Without asking: if location is already allowed, show nearby stories straight away.
  useEffect(() => {
    if (point || chosen.lat !== undefined || chosen.state) return;
    let live = true;
    Location.getForegroundPermissionsAsync()
      .then(async (p) => {
        if (!p.granted) return;
        const c = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (live) setChosen({ lat: c.coords.latitude, lng: c.coords.longitude });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [point, chosen.lat, chosen.state]);

  const load = useCallback(
    async (next?: string) => {
      const generation = ++sequence.current;
      setBusy(true);
      setError('');
      try {
        const result = await request('get', '/local-status', {
          query: { ...JSON.parse(scopeKey), ...(next ? { cursor: next } : {}) },
        });
        if (generation !== sequence.current) return;
        setItems((old) =>
          next
            ? [...old, ...result.items.filter((i) => !old.some((o) => o.id === i.id))]
            : result.items,
        );
        setCursor(result.next_cursor);
      } catch (e: any) {
        if (generation === sequence.current) setError(e.message);
      } finally {
        if (generation === sequence.current) setBusy(false);
      }
    },
    [scopeKey],
  );
  useEffect(() => {
    if (!local) {
      setItems([]);
      return;
    }
    void load();
    return () => {
      sequence.current++;
    };
  }, [load, local, refreshVersion]);

  const work = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // One circle per seller, unwatched sellers first, in feed order.
  const sellers = items
    .filter((item, index) => items.findIndex((i) => i.seller_id === item.seller_id) === index)
    .map((first) => {
      const stories = items.filter((i) => i.seller_id === first.seller_id);
      return {
        first,
        unseen: stories.some((i) => !seen.has(i.id)),
        sponsored: stories.some((i) => i.sponsored),
      };
    })
    .sort((a, b) => Number(b.unseen) - Number(a.unseen));
  // The viewer plays sellers in the same order as the row.
  const ordered = sellers.flatMap(({ first }) =>
    items.filter((i) => i.seller_id === first.seller_id),
  );
  const boosted = items.filter((i) => i.sponsored);
  // The playlist is fixed when the viewer opens, so watching a story never reorders what plays next.
  const play = (id: string) => {
    setPlaylist(ordered);
    setSelected(id);
  };
  const where = chosen.state
    ? `${chosen.lga || chosen.city}, ${chosen.state}`
    : local
      ? 'Near you'
      : 'Set your area';

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Stories</Text>
        <Pressable accessibilityRole="button" onPress={() => setManual(!manual)}>
          <Text style={s.link}>📍 {where} ›</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {seller?.status === 'APPROVED' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add your status"
            onPress={() => setTab('Sell')}
            style={styles.circleWrap}
          >
            <View style={[styles.ring, styles.ringMine]}>
              <View style={[styles.avatar, styles.addAvatar]}>
                <Text style={styles.addInitial}>
                  {(seller.business_name || '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.plus}>
                <Text style={styles.plusText}>+</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={styles.name}>
              Your status
            </Text>
          </Pressable>
        )}
        {!local && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show stories near me"
            style={styles.circleWrap}
            onPress={() =>
              void work(async () => {
                const p = await currentPosition();
                setChosen({ lat: p.latitude, lng: p.longitude });
              })
            }
          >
            <View style={[styles.ring, styles.ringSeen]}>
              <View style={[styles.avatar, styles.addAvatar]}>
                <Text style={styles.addInitial}>📍</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={styles.name}>
              Nearby
            </Text>
          </Pressable>
        )}
        {sellers.map(({ first, unseen, sponsored }) => (
          <Pressable
            key={first.seller_id}
            accessibilityRole="button"
            accessibilityLabel={`View ${first.business_name} stories`}
            onPress={() => play(first.id)}
            style={styles.circleWrap}
          >
            <View style={[styles.ring, unseen ? styles.ringNew : styles.ringSeen]}>
              <Image source={{ uri: first.thumbnail_url }} style={styles.avatar} />
              {sponsored && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>★</Text>
                </View>
              )}
            </View>
            <Text numberOfLines={1} style={[styles.name, !unseen && styles.nameSeen]}>
              {first.business_name}
            </Text>
          </Pressable>
        ))}
        {!local && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose an area for stories"
            style={styles.circleWrap}
            onPress={() => setManual(true)}
          >
            <View style={[styles.ring, styles.ringSeen]}>
              <View style={[styles.avatar, styles.addAvatar]}>
                <Text style={styles.addInitial}>⌕</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={styles.name}>
              Choose area
            </Text>
          </Pressable>
        )}
        {local && cursor && (
          <Pressable
            accessibilityRole="button"
            style={styles.circleWrap}
            onPress={() => void load(cursor)}
          >
            <View style={[styles.ring, styles.ringSeen]}>
              <View style={[styles.avatar, styles.addAvatar]}>
                <Text style={styles.addInitial}>›</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={styles.name}>
              More
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {local && !busy && !items.length && (
        <Text style={s.fine}>
          No stories in this area yet. Check back later or choose another area.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      {manual && (
        <View style={s.locationBox}>
          <Text style={s.small}>
            Stories last {settings?.status_lifetime_hours || 24} hours. You don’t need to follow
            anyone to see them.
          </Text>
          <View style={s.inlineActions}>
            <Button
              secondary
              title="Use my location"
              disabled={busy}
              onPress={() =>
                void work(async () => {
                  const p = await currentPosition();
                  setChosen({ lat: p.latitude, lng: p.longitude });
                  setManual(false);
                })
              }
            />
            <Button secondary title="By LGA" onPress={() => setAreaKind('LGA')} />
            <Button secondary title="By city" onPress={() => setAreaKind('CITY')} />
          </View>
          <Field label="State" value={state} onChangeText={setState} placeholder="e.g. Lagos" />
          <Field
            label={areaKind === 'LGA' ? 'LGA' : 'City'}
            value={lga}
            onChangeText={setLga}
            placeholder="e.g. Ikeja"
          />
          <Button
            title="Show stories in this area"
            disabled={!state.trim() || !lga.trim()}
            onPress={() => {
              setChosen({
                state: state.trim(),
                ...(areaKind === 'LGA' ? { lga: lga.trim() } : { city: lga.trim() }),
              });
              setManual(false);
            }}
          />
          {chosen.state && (
            <Button secondary title="Clear selected area" onPress={() => setChosen({})} />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void work(async () => {
                setShowMuted(!showMuted);
                setMutes(await request('get', '/local-status/preferences'));
              })
            }
          >
            <Text style={s.link}>
              {showMuted ? 'Hide muted sellers and categories' : 'Muted sellers and categories'}
            </Text>
          </Pressable>
          {showMuted && !mutes.length && <Text style={s.fine}>Nothing muted.</Text>}
          {showMuted &&
            mutes.map((m) => (
              <View key={m.kind + m.target} style={styles.muteRow}>
                <Text style={[s.small, { flex: 1 }]}>
                  {m.kind === 'SELLER' ? 'Seller' : 'Category'}: {m.label || m.target}
                </Text>
                <Button
                  secondary
                  title="Unmute"
                  onPress={() =>
                    void work(async () => {
                      await request('put', '/local-status/preferences', {
                        body: { ...m, muted: false },
                      });
                      setMutes(await request('get', '/local-status/preferences'));
                      await load();
                    })
                  }
                />
              </View>
            ))}
        </View>
      )}

      {boosted.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`Boosted story from ${item.business_name}`}
          style={styles.boosted}
          onPress={() => play(item.id)}
        >
          <Image source={{ uri: item.thumbnail_url }} style={styles.boostedThumb} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={s.bold}>
              {item.business_name}
            </Text>
            <Text numberOfLines={1} style={s.small}>
              {item.title} · {money(item.price_kobo)}
              {item.distance_km != null ? ` · ${item.distance_km} km` : ''}
            </Text>
          </View>
          <View style={styles.boostedTag}>
            <Text style={styles.boostedTagText}>Boosted</Text>
          </View>
        </Pressable>
      ))}

      <StoryViewer
        stories={playlist}
        startId={selected}
        scope={JSON.parse(scopeKey)}
        onSeen={markSeen}
        onClose={() => setSelected(null)}
        onMuted={() => {
          setSelected(null);
          void load();
        }}
      />
    </View>
  );
}

const GREEN = '#355e3b',
  GOLD = '#e9b949';
const styles = StyleSheet.create({
  section: { gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: '#203a26' },
  rail: { gap: 14, paddingVertical: 4, paddingRight: 8 },
  circleWrap: { width: 72, alignItems: 'center', gap: 6 },
  ring: { padding: 3, borderWidth: 2.5, borderRadius: 40 },
  ringNew: { borderColor: GOLD },
  ringSeen: { borderColor: '#d6dbcc' },
  ringMine: { borderColor: '#d6dbcc', borderStyle: 'dashed' },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#edf1e5' },
  addAvatar: { alignItems: 'center', justifyContent: 'center' },
  addInitial: { fontSize: 22, fontWeight: '800', color: GREEN },
  plus: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: GREEN,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  badge: {
    position: 'absolute',
    right: -3,
    top: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  name: { fontSize: 11, color: '#2f4a33', fontWeight: '600', textAlign: 'center', width: 72 },
  nameSeen: { color: '#7d8a76', fontWeight: '500' },
  error: { color: '#a33e32', fontSize: 13, lineHeight: 19 },
  muteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  boosted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e6e9dd',
  },
  boostedThumb: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#edf1e5' },
  boostedTag: {
    backgroundColor: '#fbf1d4',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  boostedTagText: { fontSize: 11, fontWeight: '700', color: '#8a6516' },
});
