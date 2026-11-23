import ParcelPanel from '../ParcelPanel';
import BackgroundTrackingControl from '../BackgroundTrackingControl';
import { stopBackgroundTracking } from '../backgroundTracking';
import ReturnJourneysPanel from '../ReturnJourneysPanel';
import DeliveryProgressPanel from '../DeliveryProgressPanel';
import ProfileDetailsPanel from '../ProfileDetailsPanel';
import { money } from '@ahia/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Switch, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { featureOn } from '../features';
import { currentPosition, directions } from '../DeliveryPanel';
import { request } from '../request';
import { snap } from '../camera';
import { uploadPhoto } from '../api';
import { VerificationDocuments } from '../SellerTools';
import { Badge, Button, Chip, Empty, Field, s } from '../ui';
import { PinQr, PinScanner } from '../PinCode';

const earnings = (d: any) => Math.round((Number(d.fare_kobo) * (10000 - d.commission_bps)) / 10000);

/** Driver mode: apply, go online, take nearby jobs and confirm deliveries with PINs. */
/**
 * Proof for a delivery step: a photo taken now with the camera, uploaded, and where the rider is.
 * Protects riders, sellers and buyers if anything is disputed later.
 */
async function evidence() {
  const shot = await snap(false);
  if (!shot) throw new Error('Take a photo of the goods to continue.');
  const photo = await uploadPhoto(shot);
  const here = await currentPosition();
  return { photo_url: photo.url, latitude: here.latitude, longitude: here.longitude };
}

export default function DriveScreen() {
  const { busy, run, setTab, settings } = useApp();
  const [driver, setDriver] = useState<any>(undefined),
    [jobs, setJobs] = useState<any>(null),
    [vehicles, setVehicles] = useState<any[]>([]),
    [form, setForm] = useState({
      vehicle_type: 'motorcycle',
      plate_number: '',
      licence_number: '',
      city: '',
    }),
    [pins, setPins] = useState<Record<string, string>>({}),
    [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const d = await request('get', '/drivers/me');
    setDriver(d);
    if (d?.status === 'APPROVED') setJobs(await request('get', '/drivers/me/jobs'));
    else if (!d || d.status === 'REJECTED')
      setVehicles((await request('get', '/delivery/options')).vehicle_types);
  }, []);
  useEffect(() => {
    void load().catch(() => setDriver(null));
  }, [load]);
  // While online, share location every 15 seconds: it matches nearby jobs and powers live tracking.
  const online = !!driver?.online;
  const sending = useRef(false);
  useEffect(() => {
    if (!online) return;
    const tick = async () => {
      if (sending.current) return;
      sending.current = true;
      try {
        await request('put', '/drivers/me/status', {
          body: { online: true, ...(await currentPosition()) },
        });
        setJobs(await request('get', '/drivers/me/jobs'));
      } catch {
      } finally {
        sending.current = false;
      }
    };
    const timer = setInterval(() => void tick(), 15000);
    return () => clearInterval(timer);
  }, [online]);

  if (driver === undefined) return <Text style={s.muted}>Loading…</Text>;
  const header = (
    <>
      <Text style={s.eyebrow}>EARN BY DELIVERING LOCALLY</Text>
      <Text style={s.heading}>Drive with Ahia</Text>
    </>
  );
  if (!driver || driver.status === 'REJECTED')
    return (
      <>
        {header}
        <Text style={s.subtitle}>
          {driver?.reason
            ? `Application feedback: ${driver.reason}`
            : 'Registration is free. Our team checks your licence and vehicle before you can take jobs.'}
        </Text>
        <Text style={s.label}>Vehicle</Text>
        <View style={s.chipWrap}>
          {vehicles.map((v) => (
            <Chip
              key={v.code}
              title={v.name}
              active={form.vehicle_type === v.code}
              onPress={() => setForm({ ...form, vehicle_type: v.code })}
            />
          ))}
        </View>
        <Field
          label="Plate number"
          value={form.plate_number}
          autoCapitalize="characters"
          onChangeText={(v: string) => setForm({ ...form, plate_number: v })}
        />
        <Field
          label="Driver’s licence number"
          value={form.licence_number}
          autoCapitalize="characters"
          onChangeText={(v: string) => setForm({ ...form, licence_number: v })}
        />
        <Field
          label="City you drive in"
          value={form.city}
          onChangeText={(v: string) => setForm({ ...form, city: v })}
        />
        <Button
          title="Apply to drive →"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await request('post', '/drivers', { body: form });
              await load();
            }, 'Application sent. Upload your licence and vehicle papers below.')
          }
        />
      </>
    );
  if (driver.status !== 'APPROVED')
    return (
      <>
        {header}
        <View style={s.orderCard}>
          <Badge status={driver.status} />
          <Text style={s.body}>
            {driver.status === 'PENDING'
              ? 'We are checking your application. Upload your documents to speed this up.'
              : driver.reason || 'Your driver account is suspended.'}
          </Text>
        </View>
        <ReturnJourneysPanel />
        <ProfileDetailsPanel subject="driver" />
        <VerificationDocuments subject="driver" />
      </>
    );
  const active = jobs?.active || [];
  return (
    <>
      {header}
      <ReturnJourneysPanel />
      <ProfileDetailsPanel subject="driver" />
      <VerificationDocuments subject="driver" />
      <View style={s.orderCard}>
        <View style={s.rowBetween}>
          <View style={s.flex}>
            <Text style={s.bold}>{online ? 'You are online' : 'You are offline'}</Text>
            <Text style={s.small}>
              {online
                ? 'Nearby jobs appear below. Your location is shared every 15 seconds.'
                : 'Go online to see delivery jobs near you.'}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Online for deliveries"
            value={online}
            disabled={busy}
            onValueChange={(value) =>
              void run(async () => {
                if (!value) await stopBackgroundTracking();
                setDriver({
                  ...driver,
                  ...(await request('put', '/drivers/me/status', {
                    body: {
                      online: value,
                      ...(value ? await currentPosition() : {}),
                    },
                  })),
                });
                setJobs(await request('get', '/drivers/me/jobs'));
              })
            }
          />
        </View>
        <Pressable onPress={() => setTab('Wallet')}>
          <Text style={s.link}>Earnings and bank payouts are in Wallet →</Text>
        </Pressable>
      </View>
      <BackgroundTrackingControl online={online} />
      {featureOn(settings, 'parcels') && <ParcelPanel driverMode />}
      {active.map((d: any) => (
        <View key={d.id} style={s.orderCard}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>{d.title}</Text>
            <Badge status={d.status} />
          </View>
          <Text style={s.body}>
            {d.quantity} {d.unit} · you earn {money(earnings(d))}
          </Text>
          <DeliveryProgressPanel delivery={d} isDriver />
          {d.status === 'ASSIGNED' ? (
            <>
              <Text style={s.bold}>Collect from {d.business_name}</Text>
              <Text style={s.body}>{d.pickup_address}</Text>
              <Pressable onPress={() => directions(d.pickup_latitude, d.pickup_longitude)}>
                <Text style={s.link}>Directions to seller ↗</Text>
              </Pressable>
              {!d.rider_checked_at ? (
                <View style={s.locationBox}>
                  <Text style={s.bold}>1 · Check the goods</Text>
                  <Text style={s.small}>
                    Look at {d.quantity} {d.unit} of {d.title} at the seller. Only continue if it
                    matches the order and is in good condition.
                  </Text>
                  {!d.booking_paid && (
                    <Text style={s.small}>
                      The buyer pays on delivery, so you pay the seller{' '}
                      {money(Number(d.total_kobo))} from your Ahia wallet. It’s held in escrow and
                      released to the seller when they hand over. The buyer pays you back in the app
                      before you give them the order.
                    </Text>
                  )}
                  <Field
                    label="Note on the goods (optional)"
                    value={notes[d.id] || ''}
                    onChangeText={(v: string) => setNotes({ ...notes, [d.id]: v })}
                    placeholder="e.g. 2 baskets, fresh, sealed"
                  />
                  <Button
                    title={
                      d.booking_paid
                        ? '📸 Photograph goods · they check out'
                        : `📸 Photograph goods · pay ${money(Number(d.total_kobo))} to escrow`
                    }
                    disabled={busy}
                    onPress={() =>
                      void run(
                        async () => {
                          await request('post', '/deliveries/{id}/{action}', {
                            params: { id: d.id, action: 'check' },
                            body: {
                              ...(notes[d.id] ? { note: notes[d.id] } : {}),
                              ...(await evidence()),
                            },
                          });
                          await load();
                        },
                        d.booking_paid
                          ? 'Goods checked. Show the seller your code.'
                          : 'Goods checked and payment held in escrow. Show the seller your code.',
                      )
                    }
                  />
                  {!d.booking_paid && (
                    <Pressable onPress={() => setTab('Wallet')}>
                      <Text style={s.link}>Top up your wallet →</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <>
                  <Text style={s.small}>
                    ✓ Goods checked
                    {Number(d.rider_fronted_kobo)
                      ? ` · you paid ${money(Number(d.rider_fronted_kobo))} into escrow`
                      : ''}
                  </Text>
                  <PinQr
                    kind="pickup"
                    deliveryId={d.id}
                    pin={d.pickup_pin}
                    title="2 · SHOW THE SELLER THIS CODE"
                    hint="The seller scans it (or types the digits) to confirm handover; escrow is then released to them."
                  />
                </>
              )}
              <Pressable
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/deliveries/{id}/{action}', {
                      params: { id: d.id, action: 'release' },
                    });
                    await load();
                  }, 'Job released for another driver.')
                }
              >
                <Text style={s.link}>I can’t do this job</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.bold}>Deliver to {d.buyer_name}</Text>
              <Text style={s.body}>{d.dropoff_address}</Text>
              <Pressable onPress={() => directions(d.dropoff_latitude, d.dropoff_longitude)}>
                <Text style={s.link}>Directions to buyer ↗</Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL(`tel:${d.buyer_phone}`)}>
                <Text style={s.link}>Call buyer</Text>
              </Pressable>
              {(!d.fare_paid || !d.booking_paid) && (
                <Text style={s.fine}>
                  Pay on Delivery: the buyer pays{' '}
                  {money(
                    (d.booking_paid ? 0 : Number(d.total_kobo)) +
                      (d.fare_paid ? 0 : Number(d.fare_kobo)),
                  )}{' '}
                  in their app before giving you the PIN
                  {Number(d.rider_fronted_kobo) ? ', which pays you back for the goods' : ''}. Never
                  accept cash.
                </Text>
              )}
              <Field
                label="Buyer’s 6-digit delivery PIN"
                value={pins[d.id] || ''}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={(v: string) => setPins({ ...pins, [d.id]: v })}
              />
              <PinScanner
                kind="delivery"
                deliveryId={d.id}
                onPin={(pin) => setPins({ ...pins, [d.id]: pin })}
              />
              <Button
                title="📸 Photo & confirm delivery"
                disabled={busy || !/^\d{6}$/.test(pins[d.id] || '')}
                onPress={() =>
                  void run(
                    async () => {
                      await request('post', '/deliveries/{id}/{action}', {
                        params: { id: d.id, action: 'deliver' },
                        body: { pin: pins[d.id], ...(await evidence()) },
                      });
                      await load();
                    },
                    `Delivered. ${money(earnings(d))} added to your earnings.`,
                  )
                }
              />
              {(!d.fare_paid || !d.booking_paid) && !d.refused_at && (
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/deliveries/{id}/{action}', {
                        params: { id: d.id, action: 'refused' },
                        body: {},
                      });
                      await load();
                    }, 'Reported. Keep the goods safe; support will contact you.')
                  }
                >
                  <Text style={s.link}>The buyer won’t pay</Text>
                </Pressable>
              )}
              {!!d.refused_at && (
                <Text style={s.fine}>
                  Reported to support. Keep the goods safe until they call.
                </Text>
              )}
            </>
          )}
        </View>
      ))}
      {online && !active.length && (
        <>
          <Text style={s.sectionTitle}>Jobs near you</Text>
          {jobs?.open.length ? (
            jobs.open.map((d: any) => (
              <View key={d.id} style={s.orderCard}>
                <Text style={s.cardTitle}>{money(earnings(d))}</Text>
                <Text style={s.body}>
                  {d.away_km} km to {d.business_name} · {d.distance_km} km trip
                </Text>
                <Text style={s.small}>Drop-off around {d.dropoff_area}</Text>
                {!d.booking_paid && d.pay_on_delivery && (
                  <Text style={s.small}>
                    You pay the seller {money(Number(d.total_kobo))} at pickup (from your wallet);
                    the buyer repays you on delivery.
                  </Text>
                )}
                <Button
                  title="Take this job"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/deliveries/{id}/{action}', {
                        params: { id: d.id, action: 'claim' },
                      });
                      await load();
                    }, 'Job accepted. Head to the seller and show your PIN.')
                  }
                />
              </View>
            ))
          ) : (
            <Empty title="No jobs right now" text="Stay online; new jobs nearby will notify you." />
          )}
        </>
      )}
      {!!jobs?.history.length && <Text style={s.sectionTitle}>Recent deliveries</Text>}
      {jobs?.history.map((d: any) => (
        <View key={d.id} style={s.walletEntry}>
          <View style={s.flex}>
            <Text style={s.bold}>{d.title}</Text>
            <Text style={s.small}>{new Date(d.delivered_at).toLocaleString()}</Text>
          </View>
          <Text style={s.bold}>+{money(earnings(d))}</Text>
        </View>
      ))}
      <ReturnJourneysPanel />
      <ProfileDetailsPanel subject="driver" />
      <VerificationDocuments subject="driver" />
    </>
  );
}
