import MarketNavigationPanel from '../MarketNavigationPanel';
import { money, type Booking } from '@ahia/shared';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import BookingSupport from '../BookingSupport';
import CounterofferPanel from '../CounterofferPanel';
import DeliveryPanel from '../DeliveryPanel';
import DirectPay from '../DirectPay';
import { featureOn } from '../features';
import { useI18n } from '../i18n';
import { request } from '../request';
import { ReviewForm } from '../TrustPanels';
import { Badge, Button, Field, s } from '../ui';

const actionMessages: Record<string, string> = {
  accept: 'Booking accepted. Stock is reserved for one week.',
  counter: 'Counteroffer sent. Stock is reserved only after buyer approval.',
  'approve-change': 'Revised terms approved. Stock is now reserved for one week.',
  'decline-change': 'Counteroffer declined.',
  decline: 'Booking declined.',
  ready: 'Buyer can now collect this order.',
  cancel: 'Booking cancelled. Any held stock and payment have been returned.',
  pay: 'Paid. Share your code only when collecting.',
  pickup: 'Pickup confirmed. Thank you for growing your local market.',
};
export default function BookingCard({
  booking: b,
  isSeller,
}: {
  booking: Booking;
  isSeller: boolean;
}) {
  const { busy, run, refresh, openHistory, openListing, settings } = useApp();
  const wallet = featureOn(settings, 'wallet');
  const [code, setCode] = useState('');
  const { t } = useI18n();
  async function bookingAction(_b: Booking, action: string, body: Record<string, unknown> = {}) {
    await run(async () => {
      await request('post', '/bookings/{id}/{action}', {
        params: { id: b.id, action },
        body: body,
      });
      if (action === 'pickup') setCode('');
    }, actionMessages[action]);
  }
  const active = ['REQUESTED', 'COUNTERED', 'ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status);
  return (
    <View style={s.orderCard} key={b.id}>
      <View style={s.rowBetween}>
        <Text style={s.eyebrow}>#{b.id.slice(0, 8).toUpperCase()}</Text>
        <Badge status={b.status} />
      </View>
      <Text style={s.cardTitle}>{b.title}</Text>
      <Text style={s.small}>
        {b.variant_name || 'Standard option'}
        {b.preorder ? ' · Pre-order' : ''}
      </Text>
      <Text style={s.muted}>
        {b.quantity} {b.unit} · {isSeller ? b.buyer_name : b.business_name}
      </Text>
      <View style={s.orderSummary}>
        <Text style={s.price}>{money(b.total_kobo)}</Text>
        <Text style={[s.small, b.paid ? { color: '#27754e' } : { color: '#a17e41' }]}>
          {b.paid
            ? t('booking.paid')
            : b.payment_recorded
              ? 'Wallet payment refunded'
              : t('booking.awaitingPayment')}
        </Text>
      </View>
      {b.reserved_until && active && (
        <Text style={s.small}>Reserved until {new Date(b.reserved_until).toLocaleString()}</Text>
      )}
      {b.pickup_address && (
        <View style={s.locationBox}>
          <Text style={s.bold}>{t('booking.address')}</Text>
          <Text style={s.body}>{b.pickup_address}</Text>
          {!isSeller && (
            <Pressable
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.pickup_address!)}`,
                )
              }
            >
              <Text style={s.link}>{t('booking.directions')}</Text>
            </Pressable>
          )}
        </View>
      )}
      {!isSeller && b.pickup_code && (
        <View style={s.codeBox}>
          <Text style={s.eyebrow}>{t('booking.codeTitle')}</Text>
          <Text style={s.pickupCode}>{b.pickup_code}</Text>
          <Text style={s.small}>{t('booking.codeHint')}</Text>
        </View>
      )}
      {isSeller && (
        <View style={s.locationBox}>
          <View style={s.rowBetween}>
            <Text style={s.small}>Order total</Text>
            <Text style={s.small}>{money(b.total_kobo)}</Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={s.small}>
              Ahia fee {b.commission_bps ? `(${b.commission_bps / 100}%)` : ''}
            </Text>
            <Text style={s.small}>
              {b.commission_kobo ? `− ${money(b.commission_kobo)}` : 'No fee'}
            </Text>
          </View>
          <View style={s.rowBetween}>
            <Text style={s.bold}>You receive</Text>
            <Text style={s.bold}>{money(b.total_kobo - b.commission_kobo)}</Text>
          </View>
          {b.status === 'REQUESTED' && (
            <Text style={s.fine}>The fee is only charged if the order completes.</Text>
          )}
        </View>
      )}
      {['ACCEPTED', 'READY_FOR_PICKUP', 'COMPLETED'].includes(b.status) && (
        <>
          {!isSeller &&
            featureOn(settings, 'market_maps') &&
            ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status) && (
              <MarketNavigationPanel bookingId={b.id} />
            )}
          <DeliveryPanel booking={b} isSeller={isSeller} />
        </>
      )}
      {!isSeller && b.status === 'COMPLETED' && <ReviewForm bookingId={b.id} />}
      {['REQUESTED', 'COUNTERED'].includes(b.status) && !b.dispute_status && (
        <CounterofferPanel
          booking={b}
          isSeller={isSeller}
          busy={busy}
          onAction={(action, body) => void bookingAction(b, action, body)}
        />
      )}
      {(['ACCEPTED', 'READY_FOR_PICKUP', 'COMPLETED'].includes(b.status) || !!b.dispute_status) && (
        <BookingSupport booking={b} isSeller={isSeller} onRefresh={refresh} />
      )}
      {b.dispute_status === 'OPEN' && (
        <Text style={s.fine}>
          This booking is under support review. Payments and collection changes are paused.
        </Text>
      )}
      {b.dispute_status !== 'OPEN' && (
        <View style={s.actions}>
          {isSeller && b.status === 'REQUESTED' && (
            <>
              <Button
                title={t('booking.accept')}
                disabled={busy}
                onPress={() => void bookingAction(b, 'accept')}
              />
              <Button
                secondary
                title={t('booking.decline')}
                disabled={busy}
                onPress={() => void bookingAction(b, 'decline')}
              />
            </>
          )}
          {isSeller && b.status === 'ACCEPTED' && (
            <Button
              title={t('booking.ready')}
              disabled={busy}
              onPress={() => void bookingAction(b, 'ready')}
            />
          )}{' '}
          {!isSeller &&
            ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status) &&
            !b.paid &&
            (wallet ? (
              <Button
                title={t('booking.pay', { amount: money(b.total_kobo) })}
                disabled={busy}
                onPress={() => void bookingAction(b, 'pay')}
              />
            ) : (
              <DirectPay
                amountKobo={b.total_kobo}
                checkout={{ purpose: 'booking', booking_id: b.id }}
                onPaid={refresh}
                paidMessage="Payment confirmed. Share your pickup code only when collecting."
              />
            ))}{' '}
          {isSeller && b.pickup_available && b.status === 'READY_FOR_PICKUP' && (
            <>
              <Field
                label="Buyer’s 6-digit pickup code"
                value={code}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setCode}
                placeholder="Ask the buyer at collection"
              />
              <Button
                title={t('booking.confirmPickup')}
                disabled={busy || !b.paid || !/^\d{6}$/.test(code)}
                onPress={() => void bookingAction(b, 'pickup', { code })}
              />
              {!b.paid && (
                <Text style={s.fine}>The buyer must pay before pickup can be confirmed.</Text>
              )}
            </>
          )}
          {active && (
            <Button
              secondary
              title={t('booking.cancel')}
              disabled={busy}
              onPress={() => void bookingAction(b, 'cancel')}
            />
          )}
          {!isSeller && ['COMPLETED', 'CANCELLED', 'EXPIRED', 'DECLINED'].includes(b.status) && (
            <Button
              secondary
              title={t('booking.again')}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const listing = await request('get', '/listings/{id}', {
                    params: { id: b.listing_id },
                  });
                  openListing(listing, {
                    variantId: b.variant_id ?? undefined,
                    quantity: b.quantity,
                  });
                })
              }
            />
          )}
          <Pressable onPress={() => openHistory(b)}>
            <Text style={s.link}>{t('booking.history')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
