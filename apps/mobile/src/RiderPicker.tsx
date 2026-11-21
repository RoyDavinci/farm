import type { NearbyRider } from '@zuru/shared';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { currentPosition, type Point } from './location';
import MapPanel from './MapPanel';
import { request } from './request';
import { Button, Field, s } from './ui';

export function PointFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Point | null;
  onChange: (point: Point | null) => void;
}) {
  const [lat, setLat] = useState(value ? String(value.latitude) : ''),
    [lng, setLng] = useState(value ? String(value.longitude) : ''),
    [error, setError] = useState(''),
    [showMap, setShowMap] = useState(false),
    [manual, setManual] = useState(false),
    [config, setConfig] = useState<{
      public_token: string | null;
      permanent_geocoding?: boolean;
    } | null>(null),
    [search, setSearch] = useState(''),
    [results, setResults] = useState<
      { id: string; label: string; latitude: number; longitude: number }[]
    >([]);
  useEffect(() => {
    void request('get', '/maps/config')
      .then(setConfig)
      .catch(() => {});
  }, []);
  const update = (latitude: string, longitude: string) => {
    setLat(latitude);
    setLng(longitude);
    const a = Number(latitude),
      b = Number(longitude);
    onChange(
      latitude.trim() &&
        longitude.trim() &&
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        Math.abs(a) <= 90 &&
        Math.abs(b) <= 180
        ? { latitude: a, longitude: b }
        : null,
    );
  };
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>{title}</Text>
      <Text style={s.fine}>
        Choose a map pin or use your current location. Confirm the address separately so the rider
        knows where to go.
      </Text>
      <Button
        secondary
        title={showMap ? 'Hide location map' : 'Choose on a map'}
        onPress={() => setShowMap((v) => !v)}
      />
      {showMap && (
        <MapPanel
          token={config?.public_token || null}
          latitude={value?.latitude}
          longitude={value?.longitude}
          selectable
          onPick={(latitude, longitude) => update(String(latitude), String(longitude))}
        />
      )}
      {config?.permanent_geocoding && (
        <>
          <Field label="Search for an address or place" value={search} onChangeText={setSearch} />
          <Button
            secondary
            title="Find address"
            disabled={search.trim().length < 3}
            onPress={() =>
              void request('get', '/maps/geocode', { query: { q: search } })
                .then(setResults)
                .catch((e) => setError(e.message))
            }
          />
          {results.map((r) => (
            <Button
              key={r.id}
              secondary
              title={r.label}
              onPress={() => {
                update(String(r.latitude), String(r.longitude));
                setResults([]);
                setShowMap(true);
              }}
            />
          ))}
        </>
      )}
      <Button
        secondary
        title={manual ? 'Hide coordinates' : 'Enter coordinates manually'}
        onPress={() => setManual((v) => !v)}
      />
      {manual && (
        <>
          <Field
            label={`${title} latitude`}
            value={lat}
            onChangeText={(v: string) => update(v, lng)}
            keyboardType="numbers-and-punctuation"
          />
          <Field
            label={`${title} longitude`}
            value={lng}
            onChangeText={(v: string) => update(lat, v)}
            keyboardType="numbers-and-punctuation"
          />
        </>
      )}
      <Button
        secondary
        title="Use my current location"
        onPress={() =>
          void currentPosition()
            .then((p) => update(String(p.latitude), String(p.longitude)))
            .catch((e) => setError(e.message))
        }
      />
      {!!error && <Text style={s.fine}>{error}</Text>}
    </View>
  );
}

export default function RiderPicker({
  point,
  vehicle,
  selected,
  onSelect,
  bookingId,
}: {
  point: Point | null;
  vehicle?: string;
  selected: NearbyRider | null;
  onSelect: (r: NearbyRider | null) => void;
  bookingId?: string;
}) {
  const [rows, setRows] = useState<NearbyRider[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!point) {
      setRows([]);
      return;
    }
    let current = true;
    setLoading(true);
    setError('');
    request('get', '/riders/nearby', {
      query: {
        lat: point.latitude,
        lng: point.longitude,
        ...(vehicle ? { vehicle_type: vehicle } : {}),
        ...(bookingId ? { booking_id: bookingId } : {}),
      },
    })
      .then((list) => {
        if (current) {
          setRows(list);
          if (selected && !list.some((r) => r.id === selected.id)) onSelect(null);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [point?.latitude, point?.longitude, vehicle, bookingId, version]);
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Choose a nearby rider</Text>
      <Text style={s.fine}>
        Verified riders who are online and have shared a recent location. Distances are approximate.
      </Text>
      {!point && <Text style={s.body}>Set your delivery location to find riders nearby.</Text>}
      {!!error && <Text style={s.fine}>{error}</Text>}
      {loading && <Text style={s.small}>Finding available riders…</Text>}
      {point && !loading && !rows.length && (
        <Text style={s.body}>
          No riders are available nearby. Try refreshing later or change the vehicle type.
        </Text>
      )}
      {rows.map((r) => (
        <View
          key={r.id}
          style={[s.orderCard, selected?.id === r.id && { borderColor: '#476641', borderWidth: 2 }]}
        >
          <Text style={s.bold}>{r.name} · Approved rider</Text>
          <Text style={s.small}>
            {r.vehicle_name} · {r.distance_km} km away · {r.completed_jobs} completed jobs ·{' '}
            {r.rating_avg ? `${r.rating_avg}/5` : 'No delivery ratings yet'}
          </Text>
          <Button
            secondary
            title={selected?.id === r.id ? '✓ Selected rider' : 'Choose this rider'}
            onPress={() => onSelect(r)}
          />
        </View>
      ))}
      {point && (
        <Button
          secondary
          title="Refresh riders"
          disabled={loading}
          onPress={() => setVersion((v) => v + 1)}
        />
      )}
    </View>
  );
}
