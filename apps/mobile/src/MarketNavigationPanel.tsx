import { useState } from 'react';
import { Text, View, Switch } from 'react-native';
import { request } from './request';
import { Button, Chip, s } from './ui';
export default function MarketNavigationPanel({ bookingId }: { bookingId: string }) {
  const [map, setMap] = useState<any>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [accessible, setAccessible] = useState(false),
    [route, setRoute] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={map ? 'Close market directions' : 'Market entrances & walkway directions'}
        disabled={busy}
        onPress={async () => {
          if (map) {
            setMap(null);
            return;
          }
          setBusy(true);
          setError('');
          try {
            const m = await request('get', '/bookings/{id}/market-map', {
              params: { id: bookingId },
            });
            setMap(m);
            setTo(m.waypoints.find((n) => n.kind === 'STALL')?.id || '');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <Text style={s.fine}>{error}</Text>}
      {map && (
        <>
          <Text style={s.bold}>{map.market.name}</Text>
          <Text style={s.small}>Collection: {map.pickup_address}</Text>
          <Text style={s.label}>Start at</Text>
          <View style={s.chipWrap}>
            {map.waypoints
              .filter((n: any) => n.kind !== 'STALL')
              .map((n: any) => (
                <Chip
                  key={n.id}
                  title={n.label}
                  active={from === n.id}
                  onPress={() => {
                    setFrom(n.id);
                    setRoute(null);
                  }}
                />
              ))}
          </View>
          <Text style={s.label}>Go to</Text>
          <View style={s.chipWrap}>
            {map.waypoints.map((n: any) => (
              <Chip
                key={n.id}
                title={n.label}
                active={to === n.id}
                onPress={() => {
                  setTo(n.id);
                  setRoute(null);
                }}
              />
            ))}
          </View>
          <View style={s.rowBetween}>
            <Text style={s.small}>Step-free walkways only</Text>
            <Switch
              value={accessible}
              onValueChange={(v) => {
                setAccessible(v);
                setRoute(null);
              }}
            />
          </View>
          <Button
            title="Show walking steps"
            disabled={!from || !to || from === to || busy}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                setRoute(
                  await request('get', '/bookings/{id}/market-route', {
                    params: { id: bookingId },
                    query: { from_id: from, to_id: to, accessible: String(accessible) },
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          {route && (
            <>
              <Text style={s.bold}>About {Math.round(route.metres)} m</Text>
              {route.steps.map((step: any, i: number) => (
                <Text key={i} style={s.body}>
                  {i + 1}. {step.from.label} → {step.to.label} ({step.metres} m).{' '}
                  {step.instructions}
                </Text>
              ))}
              <Text style={s.fine}>{route.notice}</Text>
            </>
          )}
        </>
      )}
    </View>
  );
}
