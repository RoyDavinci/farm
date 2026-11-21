import MapPanel from './MapPanel';
import { useEffect, useState } from 'react';
import { Text, View, Switch } from 'react-native';
import { money, type NearbyRider } from '@ahia/shared';
import { useApp } from './AppContext';
import { request } from './request';
import RiderPicker, { PointFields } from './RiderPicker';
import { type Point } from './location';
import { Button, Field, Chip, s } from './ui';
export default function ParcelPanel({ driverMode = false }: { driverMode?: boolean }) {
  const { me, run, busy } = useApp();
  const [mapToken, setMapToken] = useState<string | null>(null);
  useEffect(() => {
    void request('get', '/maps/config')
      .then((c) => setMapToken(c.public_token))
      .catch(() => {});
  }, []);
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<any[]>([]),
    [pickup, setPickup] = useState<Point | null>(null),
    [dropoff, setDropoff] = useState<Point | null>(null),
    [rider, setRider] = useState<NearbyRider | null>(null),
    [quote, setQuote] = useState<any>(null),
    [vehicles, setVehicles] = useState<any[]>([]),
    [form, setForm] = useState({
      state: '',
      city: '',
      vehicle_type: 'motorcycle',
      pickup_address: '',
      dropoff_address: '',
      description: '',
      weight: '1',
      waiting: '0',
      lawful: false,
    }),
    [pins, setPins] = useState<Record<string, string>>({}),
    [reports, setReports] = useState<Record<string, string>>({});
  const load = () => request('get', '/parcels').then(setRows);
  useEffect(() => {
    void load().catch(() => {});
    void request('get', '/delivery/options')
      .then((o) => setVehicles(o.vehicle_types))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void load().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [open]);
  const payload = () => ({
    pickup: pickup!,
    dropoff: dropoff!,
    state: form.state,
    city: form.city,
    vehicle_type: form.vehicle_type,
    weight_kg: Number(form.weight),
    waiting_minutes: Number(form.waiting),
  });
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={
          open
            ? 'Close parcel delivery'
            : driverMode
              ? 'Parcel delivery invitations'
              : 'Send a package without buying a product'
        }
        onPress={() => {
          setOpen(!open);
          void load();
        }}
      />
      {open && (
        <>
          <Text style={s.small}>
            Development pilot. Digital prepaid delivery, selected rider, private confirmation PINs
            and support review. Live parcel operations need the operating policy and pilot approval.
          </Text>
          {!driverMode && (
            <>
              <Text style={s.bold}>New parcel request</Text>
              {(
                [
                  'state',
                  'city',
                  'pickup_address',
                  'dropoff_address',
                  'description',
                  'weight',
                  'waiting',
                ] as const
              ).map((key) => (
                <Field
                  key={key}
                  label={
                    {
                      state: 'Pickup state',
                      city: 'Pickup city',
                      pickup_address: 'Collection address',
                      dropoff_address: 'Destination address',
                      description: 'Package contents',
                      weight: 'Package kg',
                      waiting: 'Agreed waiting minutes',
                    }[key]
                  }
                  value={form[key]}
                  onChangeText={(v: string) => {
                    setForm({ ...form, [key]: v });
                    setQuote(null);
                  }}
                />
              ))}
              <View style={s.chipWrap}>
                {vehicles.map((v) => (
                  <Chip
                    key={v.code}
                    title={v.name}
                    active={form.vehicle_type === v.code}
                    onPress={() => {
                      setForm({ ...form, vehicle_type: v.code });
                      setRider(null);
                      setQuote(null);
                    }}
                  />
                ))}
              </View>
              <PointFields
                title="Parcel pickup"
                value={pickup}
                onChange={(p) => {
                  setPickup(p);
                  setRider(null);
                  setQuote(null);
                }}
              />
              <PointFields
                title="Parcel destination"
                value={dropoff}
                onChange={(p) => {
                  setDropoff(p);
                  setQuote(null);
                }}
              />
              <RiderPicker
                point={pickup}
                vehicle={form.vehicle_type}
                selected={rider}
                onSelect={setRider}
              />
              <View style={s.rowBetween}>
                <Text style={s.small}>
                  I confirm these are lawful goods suitable for this vehicle.
                </Text>
                <Switch
                  value={form.lawful}
                  onValueChange={(v) => setForm({ ...form, lawful: v })}
                />
              </View>
              <Button
                title="Review parcel price"
                disabled={busy || !pickup || !dropoff || !form.state || !form.city}
                onPress={() =>
                  void run(async () => {
                    setQuote(await request('post', '/parcels/quote', { body: payload() }));
                  })
                }
              />
              {quote && (
                <>
                  <Text style={s.bold}>
                    {money(quote.fare_kobo)} · About {quote.distance_km.toFixed(1)} km
                  </Text>
                  <Text style={s.fine}>
                    Calculation: {quote.distance_method}. Regional pricing: {quote.pricing.source}.{' '}
                    {quote.pricing.reason || 'Standard vehicle fare applies.'}
                  </Text>
                  <Button
                    title={`Hold ${money(quote.fare_kobo)} & invite rider`}
                    disabled={
                      busy ||
                      !rider ||
                      !form.lawful ||
                      form.description.trim().length < 10 ||
                      form.pickup_address.trim().length < 8 ||
                      form.dropoff_address.trim().length < 8
                    }
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/parcels', {
                          body: {
                            ...payload(),
                            description: form.description,
                            pickup_address: form.pickup_address,
                            dropoff_address: form.dropoff_address,
                            driver_id: rider!.id,
                            expected_fare_kobo: quote.fare_kobo,
                            lawful_goods_confirmed: true,
                          },
                        });
                        setQuote(null);
                        await load();
                      }, 'Simulated parcel fare held; rider invited.')
                    }
                  />
                </>
              )}
            </>
          )}
          {rows
            .filter((p) => (driverMode ? p.driver_id === me.id : p.buyer_id === me.id))
            .map((p) => (
              <View key={p.id} style={s.orderCard}>
                <Text style={s.bold}>
                  {p.description} · {p.status.toLowerCase()}
                </Text>
                <Text style={s.small}>
                  {p.pickup_address} → {p.dropoff_address}
                </Text>
                <Text style={s.small}>
                  Fare {money(p.fare_kobo)} · Rider earns{' '}
                  {money(Math.round((p.fare_kobo * (10000 - p.commission_bps)) / 10000))}
                </Text>
                {p.pickup_pin && <Text style={s.bold}>Collection PIN: {p.pickup_pin}</Text>}
                {p.delivery_pin && (
                  <Text style={s.bold}>
                    Recipient delivery PIN: {p.delivery_pin}. Share privately with the recipient.
                  </Text>
                )}
                {p.tracking && (
                  <View>
                    <Text style={s.fine}>
                      Rider updated {new Date(p.tracking.updated_at).toLocaleTimeString()}
                      {Date.now() - new Date(p.tracking.updated_at).getTime() > 120000
                        ? ' · Location may be stale'
                        : ''}
                    </Text>
                    <MapPanel
                      token={mapToken}
                      latitude={p.tracking.latitude}
                      longitude={p.tracking.longitude}
                      markers={[
                        {
                          id: 'rider',
                          latitude: p.tracking.latitude,
                          longitude: p.tracking.longitude,
                          label: 'Your parcel rider',
                        },
                      ]}
                    />
                  </View>
                )}
                {p.review_open ? (
                  <Text style={s.small}>Paused for support: {p.review_note}</Text>
                ) : (
                  <>
                    {driverMode && p.status === 'REQUESTED' && (
                      <Button
                        title="Accept parcel delivery"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await request('post', '/parcels/{id}/action', {
                              params: { id: p.id },
                              body: { action: 'accept' },
                            });
                            await load();
                          })
                        }
                      />
                    )}{' '}
                    {driverMode && ['ACCEPTED', 'PICKED_UP'].includes(p.status) && (
                      <>
                        <Field
                          label={
                            p.status === 'ACCEPTED'
                              ? 'Sender collection PIN'
                              : 'Recipient delivery PIN'
                          }
                          value={pins[p.id] || ''}
                          onChangeText={(v: string) => setPins({ ...pins, [p.id]: v })}
                          keyboardType="number-pad"
                        />
                        <Button
                          title={
                            p.status === 'ACCEPTED'
                              ? 'Confirm parcel collection'
                              : 'Confirm parcel delivered'
                          }
                          disabled={busy || !/^\d{6}$/.test(pins[p.id] || '')}
                          onPress={() =>
                            void run(async () => {
                              await request('post', '/parcels/{id}/action', {
                                params: { id: p.id },
                                body: {
                                  action: p.status === 'ACCEPTED' ? 'pickup' : 'deliver',
                                  pin: pins[p.id],
                                },
                              });
                              await load();
                            })
                          }
                        />
                      </>
                    )}
                    {(p.status === 'REQUESTED' || (!driverMode && p.status === 'ACCEPTED')) && (
                      <Button
                        secondary
                        title="Cancel & refund held fare"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await request('post', '/parcels/{id}/action', {
                              params: { id: p.id },
                              body: { action: 'cancel' },
                            });
                            await load();
                          })
                        }
                      />
                    )}
                  </>
                )}
                {!['DELIVERED', 'CANCELLED'].includes(p.status) && (
                  <>
                    <Field
                      label="Problem or safety concern"
                      value={reports[p.id] || ''}
                      onChangeText={(v: string) => setReports({ ...reports, [p.id]: v })}
                    />
                    <Button
                      secondary
                      title="Pause for support review"
                      disabled={busy || (reports[p.id] || '').trim().length < 10}
                      onPress={() =>
                        void run(async () => {
                          await request('post', '/parcels/{id}/action', {
                            params: { id: p.id },
                            body: { action: 'report', reason: reports[p.id] },
                          });
                          await load();
                        })
                      }
                    />
                  </>
                )}
              </View>
            ))}
        </>
      )}
    </View>
  );
}
