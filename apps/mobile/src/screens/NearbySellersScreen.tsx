import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppContext';
import { VerifiedBadge } from '../BusinessTools';
import { request } from '../request';
import { FadeIn, PressScale } from '../ui';

const BRAND = '#26408f',
  ACCENT = '#f5a524',
  INK = '#18213a';

/** Shops near the buyer: nearest first when location is allowed, verified shops marked. */
export default function NearbySellersScreen() {
  const { openSeller } = useApp();
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (!p.granted) return setNote('Allow location to sort shops by distance.');
        const c = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPoint({ lat: c.coords.latitude, lng: c.coords.longitude });
      } catch {
        setNote('Location is unavailable, so shops are sorted by rating.');
      }
    })();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      void request('get', '/nearby-sellers', {
        query: { ...(point ? { lat: point.lat, lng: point.lng } : {}), ...(q ? { q } : {}) } as any,
      })
        .then(setRows)
        .catch(() => setRows([]));
    }, 300);
    return () => clearTimeout(t);
  }, [point, q]);
  return (
    <View style={{ gap: 14 }}>
      <View>
        <Text style={styles.title}>Nearby sellers</Text>
        <Text style={styles.sub}>
          {point ? 'Nearest shops first.' : note || 'Finding shops near you…'}
        </Text>
      </View>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        placeholder="Search shops or areas"
        placeholderTextColor="#8a91a6"
        accessibilityLabel="Search shops or areas"
      />
      {rows === null ? (
        <ActivityIndicator color={BRAND} />
      ) : !rows.length ? (
        <Text style={styles.sub}>No shops found.</Text>
      ) : (
        rows.map((r, i) => (
          <FadeIn key={r.seller_id} delay={Math.min(i, 8) * 40}>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel={r.business_name}
              onPress={() => openSeller(r.seller_id)}
              style={styles.card}
            >
              <View style={styles.thumb}>
                {r.image_url ? (
                  <Image source={{ uri: r.image_url }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={{ fontSize: 28 }}>🏪</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.row}>
                  <Text numberOfLines={1} style={styles.name}>
                    {r.business_name}
                  </Text>
                  {r.featured && <Text style={styles.featured}>Featured</Text>}
                </View>
                <Text numberOfLines={1} style={styles.meta}>
                  {r.area}, {r.city}
                  {r.distance_km != null ? ` · ${Math.max(0.5, r.distance_km)} km` : ''} ·{' '}
                  {r.products} products
                </Text>
                <View style={styles.row}>
                  {r.rating_count > 0 ? (
                    <Text style={styles.meta}>
                      <Text style={{ color: ACCENT }}>★</Text> {r.rating_avg.toFixed(1)} (
                      {r.rating_count})
                    </Text>
                  ) : (
                    <Text style={styles.meta}>New shop</Text>
                  )}
                  {r.verified && <VerifiedBadge small />}
                </View>
              </View>
              <Text style={styles.chev}>›</Text>
            </PressScale>
          </FadeIn>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: '#6b7390', marginTop: 2 },
  search: {
    borderWidth: 1,
    borderColor: '#d4d9e8',
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: INK,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e6f0',
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#eef1fa',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '800', color: INK, flexShrink: 1 },
  meta: { fontSize: 12, color: '#6b7390' },
  featured: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: '900',
    color: '#3b2600',
    backgroundColor: ACCENT,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  chev: { fontSize: 24, color: '#9aa1b5' },
});
