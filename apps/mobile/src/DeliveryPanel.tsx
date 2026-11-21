import DeliveryProgressPanel from './DeliveryProgressPanel';
import { money, statusLabel, type Booking, type NearbyRider } from '@zuru/shared';
import { currentPosition } from './location';
export { currentPosition } from './location';
import RiderPicker, { PointFields } from './RiderPicker';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useApp } from './AppContext';
import MapPanel from './MapPanel';
import DirectPay from './DirectPay';
import { featureOn } from './features';
import { request } from './request';
import { Badge, Button, Chip, Field, s } from './ui';
import { PinQr, PinScanner } from './PinCode';

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
  const { busy, run, settings } = useApp();
  const wallet = featureOn(settings, 'wallet');
  async function submitDelivery() {
    if (!quote || !drop) return;
    setDelivery(
      await request('post', '/bookings/{id}/{action}', {
        params: { id: b.id, action: 'delivery' },
        body: {
          vehicle_type: vehicle,
          dropoff: drop,
          dropoff_address: address,
          pay_on_delivery: pod,
          expected_fare_kobo: quote.fare_kobo,
          weight_kg: Number(weight),
          waiting_minutes: Number(waiting),
          requested_driver_id: rider?.id,
        },
      }),
    );
    setForm(false);
  }
  const token = useMapToken();
  const [delivery, setDelivery] = useState<any>(undefined),
    [options, setOptions] = useState<any>(null),
    [form, setForm] = useState(false),
    [vehicle, setVehicle] = useState('motorcycle'),
    [address, setAddress] = useState(''),
    [drop, setDrop] = useState<{ latitude: number; longitude: number } | null>(null),
    [weight, setWeight] = useState('1'),
    [waiting, setWaiting] = useState('0'),
    [quote, setQuote] = useState<any>(null),
    [rider, setRider] = useState<NearbyRider | null>(null),
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

  if (!b.delivery_available)
    return <Text style={s.fine}>This booking offers collection only.</Text>;
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
                setRider(null);
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
        <PointFields
          title="Delivery map pin"
          value={drop}
          onChange={(p) => {
            setDrop(p);
            setQuote(null);
            setRider(null);
          }}
        />
        <RiderPicker
          point={drop}
          vehicle={vehicle}
          selected={rider}
          onSelect={setRider}
          bookingId={b.id}
        />
        <Field
          label="Package weight (kg)"
          value={weight}
          keyboardType="decimal-pad"
          onChangeText={(v: string) => {
            setWeight(v);
            setQuote(null);
          }}
        />
        <Field
          label="Agreed waiting time (minutes)"
          value={waiting}
          keyboardType="number-pad"
          onChangeText={(v: string) => {
            setWaiting(v);
            setQuote(null);
          }}
        />
        {quote ? (
          <>
            <View style={s.rowBetween}>
              <Text style={s.body}>
                {quote.vehicle_name} · about {quote.distance_km} km
              </Text>
              <Text style={s.price}>{money(quote.fare_kobo)}</Text>
            </View>
            {quote.pricing?.source === 'regional' && (
              <Text style={s.small}>
                Base {money(quote.pricing.base_kobo)} · distance{' '}
                {money(quote.pricing.distance_kobo)} · load {money(quote.pricing.load_kobo)} ·
                waiting {money(quote.pricing.waiting_kobo)} · demand{' '}
                {quote.pricing.demand_bps / 10000}× · surcharge{' '}
                {money(quote.pricing.surcharge_kobo)}. {quote.pricing.reason}
              </Text>
            )}
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
            {!wallet && !pod ? (
              <DirectPay
                amountKobo={quote.fare_kobo}
                disabled={!rider || address.trim().length < 8 || !b.paid}
                checkout={{
                  purpose: 'delivery',
                  booking_id: b.id,
                  quote: {
                    vehicle_type: vehicle,
                    weight_kg: Number(weight),
                    waiting_minutes: Number(waiting),
                    dropoff: drop,
                  },
                  expected_fare_kobo: quote.fare_kobo,
                }}
                onPaid={submitDelivery}
                paidMessage="Fare paid. Delivery sent to your selected rider for acceptance."
              />
            ) : (
              <Button
                title={
                  pod
                    ? 'Request delivery · pay on arrival'
                    : `Pay ${money(quote.fare_kobo)} and request`
                }
                disabled={busy || !rider || address.trim().length < 8 || (!b.paid && !pod)}
                onPress={() =>
                  void run(submitDelivery, 'Delivery sent to your selected rider for acceptance.')
                }
              />
            )}
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
                      weight_kg: Number(weight),
                      waiting_minutes: Number(waiting),
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
      <DeliveryProgressPanel delivery={delivery} />
      <View style={s.rowBetween}>
        <Text style={s.bold}>Delivery</Text>
        <Badge status={delivery.status === 'DELIVERED' ? 'COMPLETED' : delivery.status} />
      </View>
      <Text style={s.small}>
        {delivery.status === 'OPEN'
          ? delivery.requested_driver_id
            ? 'Waiting for your selected rider to accept…'
            : 'Looking for a nearby rider…'
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
        <PinQr
          kind="delivery"
          deliveryId={delivery.id}
          pin={delivery.delivery_pin}
          title="YOUR DELIVERY CODE"
          hint="Let the driver scan this (or read out the digits) only after you have checked your order."
        />
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
          <PinScanner kind="pickup" deliveryId={delivery.id} onPin={setPin} />
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
