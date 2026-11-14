import { money, statusLabel, type Booking } from '@farmers-market/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useApp } from './AppContext';
import MapPanel from './MapPanel';
import { request } from './request';
import { Badge, Button, Chip, Field, s } from './ui';

export async function currentPosition() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission is needed for delivery.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: p.coords.latitude, longitude: p.coords.longitude };
}
export const directions = (lat: number, lng: number) =>
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);

let mapToken: Promise<string | null> | null = null;
function useMapToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    mapToken ??= request('get', '/maps/config')
      .then((c) => c.public_token)
      .catch(() => null);
    void mapToken.then(setToken);
  }, []);
  return token;
}

/** Delivery for a booking: buyers arrange and track it; sellers confirm handover to the driver. */
export default function DeliveryPanel({
  booking: b,
  isSeller,
}: {
  booking: Booking;
  isSeller: boolean;
}) {
  const { busy, run } = useApp();
  const token = useMapToken();
  const [delivery, setDelivery] = useState<any>(undefined),
    [options, setOptions] = useState<any>(null),
    [form, setForm] = useState(false),
    [vehicle, setVehicle] = useState('motorcycle'),
    [address, setAddress] = useState(''),
    [drop, setDrop] = useState<{ latitude: number; longitude: number } | null>(null),
    [quote, setQuote] = useState<any>(null),
    [pod, setPod] = useState(false),
    [pin, setPin] = useState('');
  const load = useCallback(
    () =>
      request('get', '/bookings/{id}/delivery', { params: { id: b.id } })
        .then(setDelivery)
        .catch(() => setDelivery(null)),
    [b.id],
  );
  useEffect(() => {
    void load();
  }, [load, b.status]);
  // Follow the driver while the order is on its way.
  useEffect(() => {
    if (!delivery || !['ASSIGNED', 'PICKED_UP', 'OPEN'].includes(delivery.status)) return;
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [delivery?.status, load]);
  const act = (action: string, body: Record<string, unknown> = {}, message = '') =>
    run(
      async () =>
        setDelivery(
          await request('post', '/deliveries/{id}/{action}', {
            params: { id: delivery.id, action },
            body: body,
          }),
        ),
      message,
    );

  if (delivery === undefined) return null;
  if (!delivery) {
    if (isSeller || !['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status) || b.dispute_status)
      return null;
    if (!form)
      return (
        <Button
          secondary
          title="Get it delivered instead"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              setOptions(await request('get', '/delivery/options'));
              setForm(true);
            })
          }
        />
      );
    return (
      <View style={s.locationBox}>
        <Text style={s.bold}>Delivery by a verified driver</Text>
        <Text style={s.small}>
          Drivers are independent and approved by our team. They confirm delivery with your PIN.
        </Text>
        <View style={s.chipWrap}>
          {options?.vehicle_types.map((v: any) => (
            <Chip
              key={v.code}
              title={v.name}
              active={vehicle === v.code}
              onPress={() => {
                setVehicle(v.code);
                setQuote(null);
              }}
            />
          ))}
        </View>
        <Field
          label="Delivery address"
          value={address}
          onChangeText={setAddress}
          multiline
          placeholder="House number, street, landmark, area"
        />
        <Button
          secondary
          title={
            drop ? '✓ Drop-off pin set to your location' : 'Use my current location as drop-off'
          }
          disabled={busy}
          onPress={() =>
            void run(async () => {
              setDrop(await currentPosition());
              setQuote(null);
            })
          }
        />
        {quote ? (
          <>
            <View style={s.rowBetween}>
              <Text style={s.body}>
                {quote.vehicle_name} · about {quote.distance_km} km
              </Text>
              <Text style={s.price}>{money(quote.fare_kobo)}</Text>
            </View>
            {options?.pay_on_delivery && (
              <Pressable onPress={() => setPod(!pod)}>
                <Text style={s.link}>
                  {pod ? '☑' : '☐'} Pay in the app when it arrives (Pay on Delivery)
                </Text>
              </Pressable>
            )}
            {!b.paid && !pod && (
              <Text style={s.fine}>Pay for the booking first, or choose Pay on Delivery.</Text>
            )}
            <Button
              title={
                pod
                  ? 'Request delivery · pay on arrival'
                  : `Pay ${money(quote.fare_kobo)} and request`
              }
              disabled={busy || address.trim().length < 8 || (!b.paid && !pod)}
              onPress={() =>
                void run(async () => {
                  setDelivery(
                    await request('post', '/bookings/{id}/{action}', {
                      params: { id: b.id, action: 'delivery' },
                      body: {
                        vehicle_type: vehicle,
                        dropoff: drop,
                        dropoff_address: address,
                        pay_on_delivery: pod,
                        expected_fare_kobo: quote.fare_kobo,
                      },
                    }),
                  );
                  setForm(false);
                }, 'Delivery requested. We are finding a driver near the seller.')
              }
            />
          </>
        ) : (
          <Button
            title="Get delivery price"
            disabled={busy || !drop}
            onPress={() =>
              void run(async () =>
                setQuote(
                  await request('post', '/bookings/{id}/delivery/quote', {
                    params: { id: b.id },
                    body: {
                      vehicle_type: vehicle,
                      dropoff: drop,
                    },
                  }),
                ),
              )
            }
          />
        )}
        <Pressable onPress={() => setForm(false)}>
          <Text style={s.link}>Collect it myself</Text>
        </Pressable>
      </View>
    );
  }
  const live =
    delivery.driver_latitude != null && ['ASSIGNED', 'PICKED_UP'].includes(delivery.status);
  const unpaid = !delivery.fare_paid || !delivery.booking_paid;
  return (
    <View style={s.locationBox}>
      <View style={s.rowBetween}>
        <Text style={s.bold}>Delivery</Text>
        <Badge status={delivery.status === 'DELIVERED' ? 'COMPLETED' : delivery.status} />
      </View>
      <Text style={s.small}>
        {delivery.status === 'OPEN'
          ? 'Looking for a nearby driver…'
          : delivery.driver_name
            ? `${delivery.driver_name} · ${delivery.vehicle_name} · ${delivery.plate_number}`
            : statusLabel(delivery.status)}
      </Text>
      <Text style={s.small}>
        {delivery.distance_km} km · fare {money(Number(delivery.fare_kobo))}
        {delivery.pay_on_delivery ? ' · Pay on Delivery' : ''}
      </Text>
      {live && (
        <>
          <MapPanel
            token={token}
            latitude={delivery.driver_latitude}
            longitude={delivery.driver_longitude}
            markers={[
              {
                id: 'driver',
                latitude: delivery.driver_latitude,
                longitude: delivery.driver_longitude,
                label: 'Driver',
              },
              {
                id: 'drop',
                latitude: delivery.dropoff_latitude,
                longitude: delivery.dropoff_longitude,
                label: 'Drop-off',
              },
            ]}
          />
          <Text style={s.small}>
            Driver location updated {new Date(delivery.driver_location_at).toLocaleTimeString()}
          </Text>
        </>
      )}
      {!isSeller &&
        delivery.driver_phone &&
        ['ASSIGNED', 'PICKED_UP'].includes(delivery.status) && (
          <Pressable onPress={() => void Linking.openURL(`tel:${delivery.driver_phone}`)}>
            <Text style={s.link}>Call driver</Text>
          </Pressable>
        )}
      {!isSeller && unpaid && ['ASSIGNED', 'PICKED_UP'].includes(delivery.status) && (
        <Button
          title={`Pay ${money((delivery.booking_paid ? 0 : Number(delivery.total_kobo)) + (delivery.fare_paid ? 0 : Number(delivery.fare_kobo)))} from wallet`}
          disabled={busy}
          onPress={() =>
            void act('pay', {}, 'Paid. Give the driver your delivery PIN once you have your order.')
          }
        />
      )}
      {!isSeller && delivery.delivery_pin && (
        <View style={s.codeBox}>
          <Text style={s.eyebrow}>YOUR DELIVERY PIN</Text>
          <Text style={s.pickupCode}>{delivery.delivery_pin}</Text>
          <Text style={s.small}>
            Give this to the driver only after you have checked your order.
          </Text>
        </View>
      )}
      {!isSeller && ['OPEN', 'ASSIGNED'].includes(delivery.status) && (
        <Pressable
          disabled={busy}
          onPress={() =>
            void act('cancel', {}, 'Delivery cancelled. Any fare you paid was refunded.')
          }
        >
          <Text style={s.link}>Cancel delivery</Text>
        </Pressable>
      )}
      {isSeller && delivery.status === 'ASSIGNED' && (
        <>
          <Field
            label="Driver’s 6-digit collection PIN"
            value={pin}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setPin}
            placeholder="Ask the driver to show their PIN"
          />
          <Button
            title="Hand over to driver"
            disabled={busy || !/^\d{6}$/.test(pin)}
            onPress={() =>
              void act('handover', { pin }, 'Handed over. The driver is on the way to the buyer.')
            }
          />
        </>
      )}
    </View>
  );
}
