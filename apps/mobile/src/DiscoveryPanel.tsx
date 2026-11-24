import LocalStatusFeed from './LocalStatusFeed';
import { FadeIn, PressScale, produceIcon } from './ui';
import { VerifiedBadge } from './BusinessTools';
import { Linking } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useApp } from './AppContext';
import { featureOn } from './features';
import { type Listing, money } from '@ahia/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapPanel from './MapPanel';
import { request } from './request';
import { WantIt } from './Deals';
export default function DiscoveryPanel({
  onSelect,
  refreshVersion,
  category,
  onCategory: setCategory,
}: {
  refreshVersion: number;
  name: string;
  onSelect: (l: Listing) => void;
  /** Held by the app so the Categories tab can choose it. */
  category: string;
  onCategory: (category: string) => void;
}) {
  const { settings, setTab, openSeller, run } = useApp();
  const [featured, setFeatured] = useState<any[]>([]),
    [ads, setAds] = useState<any[]>([]),
    [adPage, setAdPage] = useState(0),
    [adWidth, setAdWidth] = useState(0);
  const [q, setQ] = useState(''),
    [city, setCity] = useState(''),
    [area, setArea] = useState(''),
    [market, setMarket] = useState(''),
    [markets, setMarkets] = useState<any[]>([]),
    [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null),
    [radius, setRadius] = useState('25'),
    [sort, setSort] = useState('recent'),
    [min, setMin] = useState(''),
    [max, setMax] = useState(''),
    [rating, setRating] = useState('0'),
    [sellerType, setSellerType] = useState(''),
    [wholesale, setWholesale] = useState(false),
    [deliveryOnly, setDeliveryOnly] = useState(false),
    [availability, setAvailability] = useState(''),
    [map, setMap] = useState(false),
    [filters, setFilters] = useState(false),
    [config, setConfig] = useState<any>(null),
    [items, setItems] = useState<Listing[]>([]),
    [sponsored, setSponsored] = useState<Listing[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request('get', '/markets')
      .then(setMarkets)
      .catch(() => {});
    request('get', '/maps/config')
      .then(setConfig)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!featureOn(settings, 'promotions')) return;
    void (async () => {
      // Use the buyer's location for targeting only if they already allowed it.
      let where: { lat?: number; lng?: number } = point
        ? { lat: point.latitude, lng: point.longitude }
        : {};
      if (!point)
        try {
          const p = await Location.getForegroundPermissionsAsync();
          const last = p.granted ? await Location.getLastKnownPositionAsync() : null;
          if (last) where = { lat: last.coords.latitude, lng: last.coords.longitude };
        } catch {
          // no location: untargeted adverts only
        }
      void request('get', '/featured-sellers', { query: where as any })
        .then(setFeatured)
        .catch(() => {});
      void request('get', '/ads', {
        query: { limit: 3, ...(category ? { category } : {}), ...where } as any,
      })
        .then(setAds)
        .catch(() => {});
    })();
  }, [settings, refreshVersion, category, point]);
  const sequence = useRef(0);
  const params = JSON.stringify({
    q,
    city,
    area,
    category,
    market,
    point,
    radius,
    sort,
    min,
    max,
    rating,
    sellerType,
    wholesale,
    deliveryOnly,
    availability,
  });
  const search = useCallback(
    async (next?: string) => {
      const requestId = ++sequence.current;
      setBusy(true);
      setError('');
      try {
        const d = JSON.parse(params);
        const p = new URLSearchParams();
        for (const key of ['q', 'city', 'area', 'category', 'sort']) if (d[key]) p.set(key, d[key]);
        if (d.market) p.set('market_id', d.market);
        if (d.point) {
          p.set('lat', String(d.point.latitude));
          p.set('lng', String(d.point.longitude));
          p.set('radius_km', d.radius);
        }
        if (d.min) p.set('min_price', String(Math.round(Number(d.min) * 100)));
        if (d.max) p.set('max_price', String(Math.round(Number(d.max) * 100)));
        p.set('min_rating', d.rating);
        if (d.sellerType) p.set('seller_type', d.sellerType);
        if (d.wholesale) p.set('wholesale', 'true');
        if (d.deliveryOnly) p.set('delivery_available', 'true');
        if (d.availability) p.set('availability', d.availability);
        if (next) p.set('cursor', next);
        const result = await request('get', '/search', { query: Object.fromEntries(p) });
        if (requestId !== sequence.current) return;
        setItems((previous) =>
          next
            ? [
                ...previous,
                ...result.items.filter((item: Listing) => !previous.some((p) => p.id === item.id)),
              ]
            : result.items,
        );
        setCursor(result.next_cursor);
        if (!next) setSponsored(result.sponsored || []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [params],
  );
  useEffect(() => {
    const timeout = setTimeout(() => void search(), 400);
    return () => clearTimeout(timeout);
  }, [search, refreshVersion]);
  async function locate() {
    setBusy(true);
    setError('');
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted)
        throw new Error(
          'Location permission is needed for nearby search. You can search by city or market instead.',
        );
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPoint({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      setSort('distance');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} style={[s.chip, active && s.chipActive]} onPress={onPress}>
      <Text style={[s.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
  const deals = items.slice(0, 8),
    more = items.slice(8);
  const place = city || area || (point ? 'Near you' : 'Everywhere');
  const promoted = sponsored[0];
  const aside = promoted ? (
    <SponsoredCard listing={promoted} onPress={() => onSelect(promoted)} />
  ) : null;
  return (
    <View style={{ gap: 18 }}>
      <View style={s.locRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={point ? 'Change area and distance' : 'Find things near me'}
          disabled={busy}
          onPress={() => (point ? setFilters(!filters) : void locate())}
          style={s.locPill}
        >
          <Svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke={BRAND}
            strokeWidth={2}
          >
            <Path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
            <Circle cx={12} cy={9.5} r={2.5} />
          </Svg>
          <View>
            <Text style={s.locTitle}>{place} ⌄</Text>
            <Text style={s.locSub}>
              {point ? `Within ${radius} km` : 'Tap to see what’s near you'}
            </Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setMap(!map)} style={s.mapButton}>
          <Text style={s.mapText}>{map ? 'Hide map' : 'Map'}</Text>
        </Pressable>
      </View>

      <View style={s.searchBox}>
        <Svg
          width={20}
          height={20}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#587667"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <Circle cx={11} cy={11} r={6.5} />
          <Path d="m16 16 4.5 4.5" />
        </Svg>
        <TextInput
          style={s.searchInput}
          accessibilityLabel="Search products, sellers or markets"
          placeholder="Search products, sellers or markets…"
          placeholderTextColor="#8aa698"
          value={q}
          onChangeText={setQ}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={() => setFilters(!filters)}
          style={[s.filterButton, filters && { backgroundColor: BRAND }]}
        >
          <Svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke={filters ? '#fff' : BRAND}
            strokeWidth={2}
            strokeLinecap="round"
          >
            <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
            <Circle cx={16} cy={6} r={2} />
            <Circle cx={10} cy={12} r={2} />
            <Circle cx={18} cy={18} r={2} />
          </Svg>
        </Pressable>
      </View>

      <View style={s.quickRow}>
        {(
          [
            ['🗓️', 'My planner', '#e9f6ef', () => setTab('Planner'), 0],
            ['📍', 'Nearby sellers', '#e6fbf0', () => setTab('Nearby'), 0],
            [
              '🛵',
              'Request delivery',
              '#fde9d9',
              () =>
                featureOn(settings, 'parcels') || featureOn(settings, 'shopping')
                  ? setTab('Riders')
                  : void run(
                      async () => setTab('Bookings'),
                      'To get an order delivered, open it here and tap Request delivery once the seller accepts.',
                    ),
              0,
            ],
            ['🏪', 'Start selling', BRAND, () => setTab('Sell'), 0],
          ] as const
        ).map(([icon, label, bg, go, count], i) => (
          <PressScale
            key={label}
            accessibilityRole="button"
            accessibilityLabel={count ? `${label}, ${count} items` : label}
            onPress={go}
            wrapStyle={{ flex: 1 }}
            style={[s.quick, { backgroundColor: bg }]}
          >
            <Text style={s.quickIcon}>{icon}</Text>
            <Text style={[s.quickText, i === 3 && { color: '#fff' }]} numberOfLines={2}>
              {label}
            </Text>
            {count > 0 && (
              <View style={s.quickBadge}>
                <Text style={s.quickBadgeText}>{count > 99 ? '99+' : count}</Text>
              </View>
            )}
          </PressScale>
        ))}
      </View>

      {featureOn(settings, 'local_status') ? (
        <LocalStatusFeed
          point={point}
          category={category}
          refreshVersion={refreshVersion}
          aside={aside}
        />
      ) : (
        aside && <View style={{ height: 230 }}>{aside}</View>
      )}

      {!!ads.length && (
        <View style={{ gap: 8 }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setAdPage(
                Math.round(
                  e.nativeEvent.contentOffset.x /
                    Math.max(1, e.nativeEvent.layoutMeasurement.width),
                ),
              )
            }
            onLayout={(e) => setAdWidth(e.nativeEvent.layout.width)}
            style={s.adScroller}
          >
            {ads.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                accessibilityLabel={`Advertisement from ${a.advertiser}: ${a.title}`}
                onPress={() =>
                  void request('post', '/ads/{id}/click', { params: { id: a.id } })
                    .then((r) => {
                      if (r.link_url) void Linking.openURL(r.link_url);
                    })
                    .catch(() => {})
                }
                style={[
                  s.adSlide,
                  { width: adWidth || Math.min(780, Dimensions.get('window').width) - 44 },
                ]}
              >
                {a.image_url ? (
                  <Image source={{ uri: a.image_url }} style={s.adBanner} resizeMode="cover" />
                ) : (
                  <View style={[s.adBanner, s.adFallback]}>
                    <Text style={s.adTitle}>{a.title}</Text>
                    {!!a.body && <Text style={s.adBody}>{a.body}</Text>}
                  </View>
                )}
                <View style={s.adPill}>
                  <Text style={s.adPillText}>Ad · {a.advertiser}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          {ads.length > 1 && (
            <View style={s.dots}>
              {ads.map((a, i) => (
                <View key={a.id} style={[s.dot, i === adPage && s.dotOn]} />
              ))}
            </View>
          )}
        </View>
      )}

      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}

      <ScrollView
        horizontal
        contentContainerStyle={{ gap: 8 }}
        showsHorizontalScrollIndicator={false}
      >
        {['', ...(settings?.catalog?.categories || ['Other'])].map((c) =>
          chip(c ? `${produceIcon(c)} ${c}` : 'All', category === c, () => setCategory(c)),
        )}
      </ScrollView>

      {filters && (
        <View style={s.filterBox}>
          <View style={s.row}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel="Search city"
              value={city}
              onChangeText={setCity}
              placeholder="City"
            />
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel="Search area"
              value={area}
              onChangeText={setArea}
              placeholder="Area"
            />
          </View>
          <View style={s.wrap}>
            {chip(point ? 'Using my location' : 'Use my location', !!point, () =>
              point ? (setPoint(null), setSort('recent')) : void locate(),
            )}
            {chip('Offers delivery', deliveryOnly, () => setDeliveryOnly(!deliveryOnly))}
            {chip('Stock ready now', availability === 'in_stock', () =>
              setAvailability(availability === 'in_stock' ? '' : 'in_stock'),
            )}
            {chip('Pre-orders', availability === 'preorder', () =>
              setAvailability(availability === 'preorder' ? '' : 'preorder'),
            )}
          </View>
          {point && (
            <>
              <Text style={s.bold}>Distance</Text>
              <View style={s.wrap}>
                {['5', '10', '25', '50'].map((r) =>
                  chip(`${r} km`, radius === r, () => setRadius(r)),
                )}
              </View>
            </>
          )}
          <Text style={s.bold}>Market</Text>
          <View style={s.wrap}>
            {chip('Any market', !market, () => setMarket(''))}
            {markets
              .filter((m) => !city || m.city.toLowerCase().includes(city.toLowerCase()))
              .map((m) => chip(`${m.name} · ${m.city}`, market === m.id, () => setMarket(m.id)))}
          </View>
          <View style={s.row}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel="Minimum price naira"
              placeholder="Min price ₦"
              keyboardType="numeric"
              value={min}
              onChangeText={setMin}
            />
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel="Maximum price naira"
              placeholder="Max price ₦"
              keyboardType="numeric"
              value={max}
              onChangeText={setMax}
            />
          </View>
          <Text style={s.bold}>Seller type</Text>
          <View style={s.wrap}>
            {['', ...(settings?.catalog?.seller_types || ['individual', 'shop', 'farm'])].map((t) =>
              chip(t.replaceAll('_', ' ') || 'Any seller', sellerType === t, () =>
                setSellerType(t),
              ),
            )}
          </View>
          <Text style={s.bold}>Minimum review score</Text>
          <View style={s.wrap}>
            {['0', '3', '4', '5'].map((v) =>
              chip(v === '0' ? 'Any rating' : `${v}+ stars`, rating === v, () => setRating(v)),
            )}
          </View>
          {chip('Wholesale offers', wholesale, () => setWholesale(!wholesale))}
          <Text style={s.bold}>Sort by</Text>
          <View style={s.wrap}>
            {[
              ['recent', 'Newest'],
              ['price_asc', 'Lowest price'],
              ['price_desc', 'Highest price'],
              ['rating', 'Best rated'],
              ...(point ? [['distance', 'Nearest']] : []),
            ].map(([key, label]) => chip(label, sort === key, () => setSort(key)))}
          </View>
        </View>
      )}

      {map && (
        <>
          <MapPanel
            token={config?.public_token || null}
            latitude={point?.latitude || items[0]?.public_latitude || undefined}
            longitude={point?.longitude || items[0]?.public_longitude || undefined}
            markers={items
              .filter((l) => l.public_latitude != null && l.public_longitude != null)
              .map((l) => ({
                id: l.id,
                latitude: l.public_latitude!,
                longitude: l.public_longitude!,
                label: l.title,
              }))}
            onMarker={(id) => {
              const item = items.find((l) => l.id === id);
              if (item) onSelect(item);
            }}
          />
          <Text style={s.small}>
            Pins and distances are approximate. Exact collection details appear only after
            acceptance.
          </Text>
        </>
      )}

      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>🔥 {point ? 'Hot deals near you' : 'Hot deals'}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSort(point ? 'distance' : 'price_asc')}
        >
          <Text style={s.seeAll}>{point ? 'Nearest first ›' : 'Lowest price ›'}</Text>
        </Pressable>
      </View>
      {busy && !items.length ? (
        <Text style={s.small}>Finding products…</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.dealRail}
        >
          {deals.map((l, i) => (
            <FadeIn key={l.id} delay={Math.min(i, 6) * 60}>
              <DealCard listing={l} onPress={() => onSelect(l)} style={s.dealCard} />
            </FadeIn>
          ))}
        </ScrollView>
      )}
      {!items.length && !busy && (
        <Text style={s.body}>
          No products match these filters. Try another area, category or distance.
        </Text>
      )}
      {!busy && <WantIt query={q} few={items.length < 3} point={point} />}

      {!!featured.length && (
        <>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>⭐ Featured shops</Text>
            <Text style={s.small}>Paid placement</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.dealRail}
          >
            {featured.map((f, i) => (
              <FadeIn key={f.seller_id} delay={Math.min(i, 6) * 60}>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={`Featured shop ${f.business_name}`}
                  onPress={() => openSeller(f.seller_id)}
                  style={s.shopCard}
                >
                  <View style={s.shopPicture}>
                    {f.image_url ? (
                      <Image
                        source={{ uri: f.image_url }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={{ fontSize: 34 }}>🏪</Text>
                    )}
                    <View style={s.featuredTag}>
                      <Text style={s.featuredTagText}>Featured</Text>
                    </View>
                  </View>
                  <View style={{ padding: 10, gap: 3 }}>
                    <Text numberOfLines={1} style={s.dealTitle}>
                      {f.business_name}
                    </Text>
                    <Text numberOfLines={1} style={s.small}>
                      {f.area}, {f.city} · {f.products} products
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {f.rating_count > 0 && (
                        <Text style={s.rating}>
                          <Text style={{ color: ACCENT }}>★</Text> {Number(f.rating_avg).toFixed(1)}
                        </Text>
                      )}
                      {f.verified && <VerifiedBadge small />}
                    </View>
                  </View>
                </PressScale>
              </FadeIn>
            ))}
          </ScrollView>
        </>
      )}

      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>Your tools</Text>
      </View>
      <View style={s.quickRow}>
        {(
          [
            ['💼', 'Business hub', '#eef3fb', 'Business'],
            ['👛', 'Wallet', '#fdf3dc', 'Wallet'],
            ['🏪', 'Sell', '#e9f6ef', 'Sell'],
            ['🛵', 'Drive', '#fde9d9', 'Drive'],
          ] as const
        ).map(([icon, label, bg, tab]) => (
          <PressScale
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => setTab(tab)}
            wrapStyle={{ flex: 1 }}
            style={[s.quick, { backgroundColor: bg }]}
          >
            <Text style={s.quickIcon}>{icon}</Text>
            <Text style={s.quickText} numberOfLines={2}>
              {label}
            </Text>
          </PressScale>
        ))}
      </View>

      {featureOn(settings, 'shopping') && (
        <PressScale onPress={() => setTab('Riders')} style={s.riderPromo}>
          <Text style={s.riderEmoji}>🛵</Text>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.riderTitle}>Need someone to buy and deliver for you?</Text>
            <Text style={s.riderText}>Find a nearby rider, set a budget and send your list.</Text>
          </View>
          <Text style={s.riderArrow}>›</Text>
        </PressScale>
      )}

      {!!more.length && (
        <>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>More near you</Text>
            <Text style={s.small}>{items.length} listings</Text>
          </View>
          <View style={s.grid}>
            {more.map((l, i) => (
              <FadeIn key={l.id} delay={Math.min(i, 8) * 45} style={s.cardWrap}>
                <DealCard listing={l} onPress={() => onSelect(l)} style={{ width: '100%' }} />
              </FadeIn>
            ))}
          </View>
        </>
      )}
      {cursor && (
        <Pressable disabled={busy} style={s.button} onPress={() => void search(cursor)}>
          <Text style={s.buttonText}>{busy ? 'Loading…' : 'Load more products'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const unitLabel = (unit?: string) =>
  unit && !['item', 'items', 'piece', 'pieces', 'unit'].includes(unit.toLowerCase())
    ? `/${unit}`
    : '';

/** Product card: photo with distance badge, name, price, seller rating and a cart button. */
function DealCard({
  listing: l,
  onPress,
  style,
}: {
  listing: Listing;
  onPress: () => void;
  style?: any;
}) {
  const preorder = l.available_from && new Date(l.available_from).getTime() > Date.now();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={l.title}
      onPress={onPress}
      style={[s.deal, style]}
    >
      <View style={s.dealPicture}>
        {l.image_url ? (
          <Image
            source={{ uri: l.thumbnail_url || l.image_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize: 46 }}>{produceIcon(l.category)}</Text>
        )}
        <View style={s.distance}>
          <Text style={s.distanceText}>
            📍{' '}
            {l.distance_km != null
              ? `${Math.max(1, Math.round(Number(l.distance_km)))} km`
              : l.area || l.city}
          </Text>
        </View>
        {preorder && (
          <View style={s.preorder}>
            <Text style={s.preorderText}>Pre-order</Text>
          </View>
        )}
      </View>
      <View style={s.dealBody}>
        <Text numberOfLines={1} style={s.dealTitle}>
          {l.title}
        </Text>
        <Text numberOfLines={1} style={s.dealPrice}>
          {money(l.search_price || l.price_kobo)}
          <Text style={s.dealUnit}>{unitLabel(l.unit)}</Text>
        </Text>
        <View style={s.dealFoot}>
          {l.seller_verified && <VerifiedBadge small />}
          <Text numberOfLines={1} style={s.rating}>
            {l.rating_count ? (
              <>
                <Text style={{ color: ACCENT }}>★</Text> {Number(l.rating_avg || 0).toFixed(1)} (
                {l.rating_count})
              </>
            ) : (
              l.business_name
            )}
          </Text>
          <View style={s.cart}>
            <Svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Path d="M3 4h2l2.4 11h10.2L20 8H6.2" />
              <Circle cx={9} cy={19.5} r={1.4} />
              <Circle cx={17} cy={19.5} r={1.4} />
            </Svg>
          </View>
        </View>
      </View>
    </PressScale>
  );
}

/** Paid placement shown beside the featured story. */
function SponsoredCard({ listing: l, onPress }: { listing: Listing; onPress: () => void }) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`Sponsored: ${l.title}`}
      onPress={onPress}
      wrapStyle={{ flex: 1 }}
      style={s.sponsored}
    >
      {l.image_url ? (
        <Image
          source={{ uri: l.thumbnail_url || l.image_url }}
          style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
          resizeMode="cover"
        />
      ) : (
        <Text style={s.sponsoredIcon}>{produceIcon(l.category)}</Text>
      )}
      <View style={s.sponsoredPill}>
        <Text style={s.sponsoredPillText}>★ Sponsored</Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={s.sponsoredPrice}>
        <Text numberOfLines={2} style={s.sponsoredTitle}>
          {l.title}
        </Text>
        <Text style={s.sponsoredAmount}>{money(l.search_price || l.price_kobo)}</Text>
      </View>
      <Text numberOfLines={1} style={s.sponsoredSeller}>
        {l.business_name}
      </Text>
      <View style={s.shopNow}>
        <Text style={s.shopNowText}>Shop now ›</Text>
      </View>
    </PressScale>
  );
}

const BRAND = '#1f754a',
  ACCENT = '#f5a524',
  INK = '#143022';
const s = StyleSheet.create({
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  locPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  locTitle: { fontSize: 15, fontWeight: '800', color: INK },
  locSub: { fontSize: 12, color: BRAND, fontWeight: '600', textDecorationLine: 'underline' },
  mapButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#e8f7f0',
  },
  mapText: { fontSize: 13, fontWeight: '700', color: BRAND },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#f1f8f4',
    borderWidth: 1,
    borderColor: '#dfeee6',
  },
  searchInput: { flex: 1, fontSize: 15, color: INK, height: '100%' },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  body: { fontSize: 13, lineHeight: 20, color: '#587667' },
  input: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4e8de',
    backgroundColor: '#fff',
    fontSize: 14,
    color: INK,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbece3',
  },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 13, color: '#305c46', fontWeight: '600' },
  bold: { fontSize: 14, color: INK, fontWeight: '700' },
  small: { fontSize: 12, lineHeight: 17, color: '#7ea08f' },
  filterBox: { padding: 16, backgroundColor: '#eef9f3', borderRadius: 18, gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: INK, letterSpacing: -0.3 },
  seeAll: { fontSize: 13, fontWeight: '700', color: BRAND },
  dealRail: { gap: 12, paddingRight: 6, paddingBottom: 4 },
  dealCard: { width: 158 },
  deal: {
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2f0e9',
    overflow: 'hidden',
    shadowColor: '#163a28',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  dealPicture: {
    height: 116,
    backgroundColor: '#e3f5ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  distanceText: { fontSize: 11, fontWeight: '700', color: INK },
  preorder: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  preorderText: { fontSize: 10, fontWeight: '800', color: '#3b2600' },
  dealBody: { padding: 11, gap: 3 },
  dealTitle: { fontSize: 14, fontWeight: '700', color: INK },
  dealPrice: { fontSize: 17, fontWeight: '800', color: BRAND },
  dealUnit: { fontSize: 13, fontWeight: '600', color: '#587667' },
  dealFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 2,
  },
  rating: { flex: 1, fontSize: 12, color: '#3d5f4e', fontWeight: '600' },
  cart: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  // The fade-in wrapper takes the grid width; the card fills it.
  cardWrap: { width: '48%' },
  riderPromo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#fff4e0',
    borderWidth: 1,
    borderColor: '#f8dca6',
  },
  riderEmoji: { fontSize: 30 },
  quickRow: { flexDirection: 'row', gap: 8 },
  quick: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
    minHeight: 86,
    justifyContent: 'center',
  },
  quickIcon: { fontSize: 26 },
  quickText: { fontSize: 12, fontWeight: '800', color: INK, textAlign: 'center' },
  quickBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#d63a2c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  quickBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  adScroller: { borderRadius: 18 },
  adSlide: { borderRadius: 18, overflow: 'hidden' },
  adBanner: { width: '100%', aspectRatio: 2, borderRadius: 18, backgroundColor: '#eefaf4' },
  adFallback: { padding: 18, justifyContent: 'center', gap: 6 },
  adPill: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(10,33,21,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  adPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#cfe6db' },
  dotOn: { width: 18, backgroundColor: BRAND },
  shopCard: {
    width: 170,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2f0e9',
    overflow: 'hidden',
  },
  shopPicture: {
    height: 96,
    backgroundColor: '#eefaf4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  featuredTagText: { fontSize: 10, fontWeight: '900', color: '#3b2600' },
  adTitle: { fontSize: 15, fontWeight: '800', color: INK },
  adBody: { fontSize: 12, color: '#4c6c5c', lineHeight: 17 },
  riderTitle: { fontSize: 14, fontWeight: '800', color: '#3b2a07' },
  riderText: { fontSize: 12, color: '#7a5a1c' },
  riderArrow: { fontSize: 26, color: '#b57a10' },
  sponsored: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#175a39',
    padding: 10,
    overflow: 'hidden',
    gap: 6,
    height: '100%',
  },
  sponsoredIcon: { position: 'absolute', alignSelf: 'center', top: '24%', fontSize: 56 },
  sponsoredPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  sponsoredPillText: { fontSize: 10, fontWeight: '800', color: '#ffd27a' },
  sponsoredPrice: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    padding: 8,
    transform: [{ rotate: '-2deg' }],
  },
  sponsoredTitle: { fontSize: 13, fontWeight: '800', color: '#1b1503' },
  sponsoredAmount: { fontSize: 17, fontWeight: '900', color: '#1b1503' },
  sponsoredSeller: { fontSize: 11, color: '#dbf7e9', fontWeight: '600', textAlign: 'center' },
  shopNow: { backgroundColor: '#fff', borderRadius: 16, paddingVertical: 7, alignItems: 'center' },
  shopNowText: { fontSize: 12, fontWeight: '800', color: INK },
  error: {
    fontSize: 13,
    color: '#a33e32',
    padding: 13,
    backgroundColor: '#fbecea',
    borderRadius: 12,
  },
  button: { padding: 15, backgroundColor: BRAND, borderRadius: 14, alignItems: 'center' },
  buttonText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
