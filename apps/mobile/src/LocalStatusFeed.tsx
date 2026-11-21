import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { money, type LocalStatus } from '@ahia/shared';
import { useApp } from './AppContext';
import { currentPosition } from './location';
import { request } from './request';
import StoryViewer from './StoryViewer';
import { Button, Field, PressScale, Pulse, s } from './ui';

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
  aside,
}: {
  point: { latitude: number; longitude: number } | null;
  category: string;
  refreshVersion: number;
  /** Shown beside the featured story (a sponsored product), or full width without one. */
  aside?: ReactNode;
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
  // The big card: a boosted story first, else the first one not yet watched.
  const feature =
    ordered.find((i) => i.sponsored) || ordered.find((i) => !seen.has(i.id)) || ordered[0];
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
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}>
            <View style={styles.titleIconDot} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Local Status</Text>
            <Pressable accessibilityRole="button" onPress={() => setManual(!manual)}>
              <Text style={styles.subtitle}>
                {local
                  ? `Products & offers ${where === 'Near you' ? 'around you' : `in ${where}`}`
                  : 'Set your area to see local offers'}{' '}
                ⌄
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => (ordered.length ? play(ordered[0].id) : setManual(true))}
          >
            <Text style={styles.seeAll}>See all ›</Text>
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
                <View style={[styles.avatar, styles.addFilled]}>
                  <Text style={styles.addPlus}>+</Text>
                </View>
              </View>
              <Text numberOfLines={1} style={styles.name}>
                Add status
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
                {unseen && <View style={styles.newDot} />}
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
      </View>

      {(feature || aside) && (
        <View style={styles.featureRow}>
          {feature && (
            <FeaturedStory
              story={feature}
              count={items.filter((i) => i.seller_id === feature.seller_id).length}
              onPress={() => play(feature.id)}
            />
          )}
          {aside && <View style={feature ? styles.asideBeside : styles.asideFull}>{aside}</View>}
        </View>
      )}

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

const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

/** A large story card: photo, seller, time, price tag and a pulsing play button. */
function FeaturedStory({
  story,
  count,
  onPress,
}: {
  story: LocalStatus;
  count: number;
  onPress: () => void;
}) {
  const seconds = story.duration_seconds || 0;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`Watch ${story.business_name}: ${story.title}`}
      onPress={onPress}
      wrapStyle={{ flex: 1 }}
      style={styles.feature}
    >
      <ImageBackground
        source={{ uri: story.thumbnail_url }}
        style={styles.featureImage}
        resizeMode="cover"
      >
        <View style={styles.featureShade} />
        <View style={styles.segments}>
          {Array.from({ length: Math.min(Math.max(count, 1), 6) }, (_, i) => (
            <View key={i} style={[styles.segment, i === 0 && styles.segmentOn]} />
          ))}
        </View>
        <View style={styles.featureTop}>
          <View style={styles.sellerChip}>
            <View style={styles.sellerAvatar}>
              <Text style={styles.sellerInitial}>{(story.business_name || '?').slice(0, 1)}</Text>
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text numberOfLines={1} style={styles.sellerName}>
                {story.business_name}
              </Text>
              <Text numberOfLines={1} style={styles.sellerMeta}>
                {story.distance_km != null
                  ? `${Math.max(1, Math.round(story.distance_km))} km away · `
                  : ''}
                {ago(story.created_at)}
              </Text>
            </View>
          </View>
          {story.media_type === 'VIDEO' && seconds > 0 && (
            <View style={styles.duration}>
              <Text style={styles.durationText}>
                ▶ 0:{String(Math.round(seconds)).padStart(2, '0')}
              </Text>
            </View>
          )}
        </View>
        <Pulse style={styles.play}>
          <Text style={styles.playIcon}>▶</Text>
        </Pulse>
        <View style={styles.featureBottom}>
          <View style={{ flexShrink: 1, gap: 6 }}>
            <View style={styles.priceTag}>
              <Text numberOfLines={2} style={styles.priceTitle}>
                {story.title}
              </Text>
              <Text style={styles.priceAmount}>{money(story.price_kobo)}</Text>
            </View>
            <View style={styles.orderNow}>
              <Text style={styles.orderNowText}>Order now!</Text>
            </View>
          </View>
          <View style={styles.viewProduct}>
            <Text style={styles.viewProductText}>View ›</Text>
          </View>
        </View>
      </ImageBackground>
    </PressScale>
  );
}

const GREEN = '#26408f',
  GOLD = '#f5a524';
const styles = StyleSheet.create({
  section: { gap: 14 },
  card: {
    backgroundColor: '#eef1fa',
    borderRadius: 22,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#dfe5f5',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleIconDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: GOLD },
  title: { fontSize: 18, fontWeight: '800', color: '#18213a' },
  subtitle: { fontSize: 12, color: '#5d6684', marginTop: 1 },
  seeAll: { fontSize: 13, fontWeight: '700', color: GREEN },
  addFilled: { backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  addPlus: { color: '#fff', fontSize: 34, fontWeight: '300', lineHeight: 38 },
  newDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: GOLD,
    borderWidth: 3,
    borderColor: '#eef1fa',
  },
  featureRow: { flexDirection: 'row', gap: 10, height: 236 },
  asideBeside: { width: '36%' },
  asideFull: { flex: 1 },
  feature: {
    flex: 1,
    height: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1b2547',
  },
  featureImage: { flex: 1, padding: 10, justifyContent: 'space-between' },
  featureShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(12,18,40,0.28)',
  },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)' },
  segmentOn: { backgroundColor: '#fff' },
  featureTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 8,
  },
  sellerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(10,16,36,0.45)',
    borderRadius: 22,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    flexShrink: 1,
  },
  sellerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  sellerInitial: { fontWeight: '900', color: '#1b1503', fontSize: 13 },
  sellerName: { color: '#fff', fontWeight: '800', fontSize: 13 },
  sellerMeta: { color: '#dfe5f7', fontSize: 11 },
  duration: {
    backgroundColor: 'rgba(10,16,36,0.55)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  durationText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(10,16,36,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 20, marginLeft: 3 },
  featureBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  priceTag: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    transform: [{ rotate: '-2deg' }],
  },
  priceTitle: { color: '#fff', fontWeight: '800', fontSize: 14 },
  priceAmount: { color: '#fff', fontWeight: '900', fontSize: 16 },
  orderNow: {
    alignSelf: 'flex-start',
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    transform: [{ rotate: '-2deg' }],
  },
  orderNowText: { color: '#1b1503', fontWeight: '900', fontSize: 12 },
  viewProduct: {
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  viewProductText: { color: '#18213a', fontWeight: '800', fontSize: 12 },
  rail: { gap: 14, paddingVertical: 4, paddingRight: 8 },
  circleWrap: { width: 72, alignItems: 'center', gap: 6 },
  ring: { padding: 3, borderWidth: 2.5, borderRadius: 40 },
  ringNew: { borderColor: GREEN },
  ringSeen: { borderColor: '#cacfdd' },
  ringMine: { borderColor: GREEN },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#e3e7f3' },
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
  name: { fontSize: 11, color: '#263153', fontWeight: '600', textAlign: 'center', width: 72 },
  nameSeen: { color: '#6f7891', fontWeight: '500' },
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
    borderColor: '#dbdfeb',
  },
  boostedThumb: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e3e7f3' },
  boostedTag: {
    backgroundColor: '#dce3f3',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  boostedTagText: { fontSize: 11, fontWeight: '700', color: '#93620d' },
});
