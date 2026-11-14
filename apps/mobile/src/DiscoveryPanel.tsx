import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { type Listing, money } from '@farmers-market/shared';
import { api } from './api';
import MapPanel from './MapPanel';
export default function DiscoveryPanel({
  name,
  onSelect,
  refreshVersion,
}: {
  refreshVersion: number;
  name: string;
  onSelect: (l: Listing) => void;
}) {
  const [q, setQ] = useState(''),
    [city, setCity] = useState(''),
    [area, setArea] = useState(''),
    [category, setCategory] = useState(''),
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
    [map, setMap] = useState(false),
    [filters, setFilters] = useState(false),
    [config, setConfig] = useState<any>(null),
    [items, setItems] = useState<Listing[]>([]),
    [sponsored, setSponsored] = useState<Listing[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/markets')
      .then(setMarkets)
      .catch(() => {});
    api('/maps/config')
      .then(setConfig)
      .catch(() => {});
  }, []);
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
        if (next) p.set('cursor', next);
        const result = await api(`/search?${p}`);
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
  const card = (l: Listing, tag = '') => (
    <Pressable key={`${tag}${l.id}`} style={s.product} onPress={() => onSelect(l)}>
      <View style={s.picture}>
        {l.image_url ? (
          <Image
            source={{ uri: l.thumbnail_url || l.image_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize: 60 }}>
            {{
              Vegetables: '🥬',
              Fruit: '🍌',
              Grains: '🌽',
              Tubers: '🥔',
              Livestock: '🥚',
              Other: '🌱',
            }[l.category] || '🌱'}
          </Text>
        )}
      </View>
      <View style={s.productBody}>
        {tag && <Text style={s.sponsoredTag}>SPONSORED</Text>}
        {l.available_from && new Date(l.available_from).getTime() > Date.now() && (
          <Text style={s.small}>
            Pre-order · ready {new Date(l.available_from).toLocaleDateString()}
          </Text>
        )}
        <Text style={s.bold}>{l.title}</Text>
        <Text style={s.small}>{l.business_name}</Text>
        <Text style={s.price}>From {money(l.search_price || l.price_kobo)}</Text>
        <Text style={s.small}>
          {l.variants?.length || 1} option(s) · {l.area}, {l.city}
        </Text>
        {l.distance_km != null && (
          <Text style={s.small}>About {Number(l.distance_km).toFixed(1)} km away</Text>
        )}
      </View>
    </Pressable>
  );
  return (
    <View style={{ gap: 17 }}>
      <Text style={s.eyebrow}>YOUR EVERYDAY LOCAL MARKET</Text>
      <Text style={s.heading}>Fresh finds.{'\n'}Close to home.</Text>
      <Text style={s.body}>
        Hello {name.split(' ')[0]}. Discover produce by area, market or distance.
      </Text>
      <View style={s.hero}>
        <Text style={s.heroTitle}>A little local. A lot of good.</Text>
        <Text style={s.heroText}>Find the growers behind your next harvest.</Text>
      </View>
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <TextInput
        style={s.input}
        accessibilityLabel="Search produce or seller"
        placeholder="Search produce or sellers"
        value={q}
        onChangeText={setQ}
      />
      <View style={s.row}>
        <Pressable disabled={busy} onPress={() => void locate()}>
          <Text style={s.link}>{point ? '⌖ Nearby search active' : '⌖ Use my location'}</Text>
        </Pressable>
        {point && (
          <Pressable
            onPress={() => {
              setPoint(null);
              setSort('recent');
            }}
          >
            <Text style={s.link}>Clear location</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setMap(!map)}>
          <Text style={s.link}>{map ? 'Hide map' : 'Show map'}</Text>
        </Pressable>
        <Pressable onPress={() => setFilters(!filters)}>
          <Text style={s.link}>Filters</Text>
        </Pressable>
      </View>
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
      <ScrollView
        horizontal
        contentContainerStyle={{ gap: 8 }}
        showsHorizontalScrollIndicator={false}
      >
        {['', 'Vegetables', 'Fruit', 'Grains', 'Tubers', 'Livestock', 'Other'].map((c) =>
          chip(c || 'All produce', category === c, () => setCategory(c)),
        )}
      </ScrollView>
      {filters && (
        <View style={s.filterBox}>
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
          {point && (
            <>
              <Text style={s.bold}>Radius (km)</Text>
              <TextInput
                style={s.input}
                keyboardType="number-pad"
                value={radius}
                onChangeText={setRadius}
              />
            </>
          )}
          <Text style={s.bold}>Seller type</Text>
          <View style={s.wrap}>
            {['', 'farm', 'shop', 'market_stall', 'home_based'].map((t) =>
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
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {[
          ['recent', 'Newest'],
          ['price_asc', 'Lowest price'],
          ['price_desc', 'Highest price'],
          ['rating', 'Best rated'],
          ...(point ? [['distance', 'Nearest']] : []),
        ].map(([key, label]) => chip(label, sort === key, () => setSort(key)))}
      </ScrollView>
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
      {!!sponsored.length && (
        <>
          <Text style={s.small}>Sponsored by sellers · paid placement</Text>
          <View style={s.grid}>{sponsored.map((l) => card(l, 'sponsored-'))}</View>
        </>
      )}
      <Text style={s.bold}>{busy ? 'Finding fresh produce…' : `${items.length} fresh finds`}</Text>
      <View style={s.grid}>{items.map((l) => card(l))}</View>
      {!items.length && !busy && (
        <Text style={s.body}>
          No produce matches these filters. Try another city, market or radius.
        </Text>
      )}
      {cursor && (
        <Pressable disabled={busy} style={s.button} onPress={() => void search(cursor)}>
          <Text style={s.buttonText}>Load more produce</Text>
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  sponsoredTag: { fontSize: 8, letterSpacing: 1, color: '#9b8147', fontWeight: '700' },
  eyebrow: { fontSize: 9, letterSpacing: 1.5, color: '#82966e' },
  heading: { fontSize: 32, lineHeight: 39, color: '#315335', fontWeight: '700', letterSpacing: -1 },
  body: { fontSize: 12, lineHeight: 20, color: '#89967a' },
  hero: { padding: 24, borderRadius: 14, backgroundColor: '#315738', gap: 14 },
  heroTitle: { fontSize: 24, color: '#edf3dc', fontWeight: '600' },
  heroText: { fontSize: 11, color: '#b9c9a5' },
  input: {
    padding: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dfe6d6',
    backgroundColor: '#fff',
    fontSize: 12,
    color: '#426039',
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#f0f3e9',
    borderWidth: 1,
    borderColor: '#e3e9d8',
  },
  chipActive: { backgroundColor: '#42663c', borderColor: '#42663c' },
  chipText: { fontSize: 10, color: '#80916b' },
  link: { fontSize: 11, color: '#6a8b51', padding: 4 },
  bold: { fontSize: 13, color: '#4e6b40', fontWeight: '600' },
  small: { fontSize: 9, lineHeight: 16, color: '#96a087' },
  filterBox: { padding: 16, backgroundColor: '#f3f6eb', borderRadius: 10, gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 13 },
  product: {
    width: '47.8%',
    borderWidth: 1,
    borderColor: '#e2e9d8',
    borderRadius: 11,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  picture: {
    height: 140,
    backgroundColor: '#eaf0db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  productBody: { padding: 13, gap: 9 },
  price: { fontSize: 13, fontWeight: '600', color: '#64804b' },
  error: {
    fontSize: 12,
    color: '#a86a4d',
    padding: 13,
    backgroundColor: '#f8ece3',
    borderRadius: 7,
  },
  button: { padding: 14, backgroundColor: '#3c6037', borderRadius: 8, alignItems: 'center' },
  buttonText: { fontSize: 12, color: '#edf3e2' },
});
