import { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import * as Location from 'expo-location';
import type { ShoppingDetail } from '@ahia/shared';
import MapPanel from './MapPanel';
import { request } from './request';
import { Button, s } from './ui';

export default function ShoppingTracking({ row, rider }: { row: ShoppingDetail; rider: boolean }) {
  const [sharing, setSharing] = useState(false),
    [error, setError] = useState(''),
    [token, setToken] = useState<string | null>(null);
  const active = ['SHOPPING', 'PURCHASED'].includes(row.status) && !row.review_open;
  useEffect(() => {
    void request('get', '/maps/config')
      .then((c) => setToken(c.public_token))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!sharing || !active || !rider) return;
    let stopped = false,
      pending = false;
    const tick = async () => {
      if (stopped || pending || AppState.currentState !== 'active') return;
      pending = true;
      try {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!stopped) {
          await request('post', '/shopping/{id}/location', {
            params: { id: row.id },
            body: { latitude: p.coords.latitude, longitude: p.coords.longitude },
          });
          setError('');
        }
      } catch (e: any) {
        if (!stopped) setError(e.message || 'Unable to share your location.');
      } finally {
        pending = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sharing, active, rider, row.id]);
  if (!active) return null;
  const position = row.tracking,
    stale = !position || Date.now() - new Date(position.updated_at).getTime() > 60000;
  return (
    <View style={s.orderCard}>
      <Text style={s.bold}>Live rider location</Text>
      {rider && (
        <>
          <Text style={s.fine}>
            Share while this request is open on your screen. Location updates pause when the app
            goes into the background. Drive mode can also share while online.
          </Text>
          <Button
            secondary
            title={sharing ? 'Stop sharing location' : 'Share my location'}
            onPress={() => {
              if (sharing) {
                setSharing(false);
                return;
              }
              void Location.requestForegroundPermissionsAsync()
                .then((p) => {
                  if (p.granted) {
                    setError('');
                    setSharing(true);
                  } else setError('Allow location access to share your position.');
                })
                .catch((e) => setError(e.message));
            }}
          />
        </>
      )}
      {!!error && <Text style={s.fine}>{error}</Text>}
      {position ? (
        <>
          <MapPanel
            token={token}
            latitude={position.latitude}
            longitude={position.longitude}
            markers={[
              {
                id: row.rider_id,
                latitude: position.latitude,
                longitude: position.longitude,
                label: stale ? 'Last known rider location' : 'Rider',
              },
            ]}
          />
          <Text style={s.small}>
            {stale ? 'Location is out of date. Last update' : 'Last updated'}:{' '}
            {new Date(position.updated_at).toLocaleTimeString()}
          </Text>
        </>
      ) : (
        <Text style={s.fine}>Waiting for the rider to share their location.</Text>
      )}
    </View>
  );
}
