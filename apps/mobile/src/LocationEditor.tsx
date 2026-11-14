import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MapPanel from './MapPanel';
import { request } from './request';
type Pin = { latitude?: number; longitude?: number; market_id?: string };
export function LocationPicker({ value, onChange }: { value: Pin; onChange: (v: Pin) => void }) {
  const [config, setConfig] = useState<any>(null),
    [markets, setMarkets] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  useEffect(() => {
    request('get', '/maps/config')
      .then(setConfig)
      .catch(() => {});
    request('get', '/markets')
      .then(setMarkets)
      .catch(() => {});
  }, []);
  async function locate() {
    setBusy(true);
    setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error('Allow location access or enter your pickup coordinates manually.');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onChange({ ...value, latitude: p.coords.latitude, longitude: p.coords.longitude });
      setShow(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.box}>
      <Text style={s.title}>Private collection pin</Text>
      <Text style={s.small}>
        Use your collection point, not a buyer’s location. Public discovery shows an approximate
        area; accepted bookings receive this exact pin.
      </Text>
      {error && <Text style={s.error}>{error}</Text>}
      <View style={s.row}>
        <Pressable disabled={busy} onPress={() => void locate()}>
          <Text style={s.link}>{busy ? 'Locating…' : 'Use my current location'}</Text>
        </Pressable>
        <Pressable onPress={() => setShow(!show)}>
          <Text style={s.link}>{show ? 'Hide pin map' : 'Pick on a map'}</Text>
        </Pressable>
      </View>
      <View style={s.row}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          accessibilityLabel="Pickup latitude"
          placeholder="Latitude"
          keyboardType="numbers-and-punctuation"
          value={value.latitude === undefined ? '' : String(value.latitude)}
          onChangeText={(v) => onChange({ ...value, latitude: v.trim() ? Number(v) : undefined })}
        />
        <TextInput
          style={[s.input, { flex: 1 }]}
          accessibilityLabel="Pickup longitude"
          placeholder="Longitude"
          keyboardType="numbers-and-punctuation"
          value={value.longitude === undefined ? '' : String(value.longitude)}
          onChangeText={(v) => onChange({ ...value, longitude: v.trim() ? Number(v) : undefined })}
        />
      </View>
      {show && (
        <MapPanel
          token={config?.public_token || null}
          latitude={value.latitude}
          longitude={value.longitude}
          selectable
          onPick={(latitude, longitude) => onChange({ ...value, latitude, longitude })}
        />
      )}
      {config?.permanent_geocoding && (
        <>
          <TextInput
            style={s.input}
            placeholder="Look up a collection address"
            value={query}
            onChangeText={setQuery}
          />
          <Pressable
            disabled={busy || query.length < 3}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                setResults(await request('get', '/maps/geocode', { query: { q: query } }));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={s.link}>Search address</Text>
          </Pressable>
          {results.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => {
                onChange({ ...value, latitude: r.latitude, longitude: r.longitude });
                setResults([]);
                setShow(true);
              }}
            >
              <Text style={s.body}>{r.label}</Text>
            </Pressable>
          ))}
        </>
      )}
      <Text style={s.title}>Market (optional)</Text>
      <View style={s.wrap}>
        <Pressable onPress={() => onChange({ ...value, market_id: undefined })}>
          <Text style={[s.link, !value.market_id && { fontWeight: '700' }]}>No market</Text>
        </Pressable>
        {markets.map((m) => (
          <Pressable key={m.id} onPress={() => onChange({ ...value, market_id: m.id })}>
            <Text style={[s.link, value.market_id === m.id && { fontWeight: '700' }]}>
              {m.name} · {m.city}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function SellerLocationPanel({
  seller,
  onSaved,
}: {
  seller: any;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [address, setAddress] = useState(seller.address),
    [city, setCity] = useState(seller.city),
    [area, setArea] = useState(seller.area),
    [pin, setPin] = useState<Pin>({
      latitude: seller.latitude ?? undefined,
      longitude: seller.longitude ?? undefined,
      market_id: seller.market_id || undefined,
    }),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <View style={s.box}>
      <Pressable onPress={() => setOpen(!open)}>
        <Text style={s.link}>
          {open ? 'Close location settings' : 'Edit collection address / map pin →'}
        </Text>
      </Pressable>
      {open && (
        <>
          <Text style={s.small}>
            Changing the location sends your seller profile back for approval. Existing accepted
            bookings retain their original collection details.
          </Text>
          <TextInput
            style={s.input}
            accessibilityLabel="Collection address"
            value={address}
            onChangeText={setAddress}
            placeholder="Collection address"
          />
          <View style={s.row}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel="Seller city"
              value={city}
              onChangeText={setCity}
            />
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel="Seller area"
              value={area}
              onChangeText={setArea}
            />
          </View>
          <LocationPicker value={pin} onChange={setPin} />
          <TextInput
            style={s.input}
            accessibilityLabel="Location change reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Reason for this location change"
          />
          {error && <Text style={s.error}>{error}</Text>}
          <Pressable
            disabled={
              busy ||
              !Number.isFinite(pin.latitude) ||
              !Number.isFinite(pin.longitude) ||
              reason.trim().length < 5
            }
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await request('patch', '/sellers/me/location', {
                  body: { ...pin, address, city, area, reason },
                });
                await onSaved();
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={s.link}>{busy ? 'Saving…' : 'Save and submit for approval'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  box: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#e0e8d4',
    borderRadius: 9,
    gap: 13,
    backgroundColor: '#f7f9f0',
  },
  title: { fontSize: 12, color: '#5e7b49', fontWeight: '600' },
  small: { fontSize: 10, lineHeight: 18, color: '#8c9a7b' },
  body: { fontSize: 12, color: '#7b9164', padding: 8 },
  input: {
    padding: 12,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#dfe7d1',
    fontSize: 12,
    color: '#4e6c3a',
    backgroundColor: '#fff',
  },
  row: { flexDirection: 'row', gap: 15, alignItems: 'center', flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  link: { fontSize: 11, color: '#6b8a50', paddingVertical: 5 },
  error: { fontSize: 11, color: '#a36745' },
});
