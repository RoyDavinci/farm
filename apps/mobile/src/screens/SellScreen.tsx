import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { money, statusLabel, type Booking, type Listing } from '@farmers-market/shared';
import { api } from '../api';
import { LocationPicker, SellerLocationPanel } from '../LocationEditor';
import BookingCard from './BookingCard';
import SellerAnalytics from '../SellerAnalytics';
import { PromoteListing, VerificationDocuments } from '../SellerTools';
import { shareOnWhatsApp, shopMessage } from '../share';
import { Field, Button, Chip, Badge, Empty, Back, s } from '../ui';
import { useApp } from '../AppContext';
import { useI18n } from '../i18n';

export default function SellScreen({
  mine,
  incoming,
  onEditListing,
}: {
  mine: Listing[];
  incoming: Booking[];
  onEditListing: (listing: Listing | null) => void;
}) {
  const { seller, settings, busy, run, refresh, openSeller } = useApp();
  const { t } = useI18n();
  const [profile, setProfile] = useState({
    business_name: '',
    business_type: 'farm',
    city: '',
    area: '',
    address: '',
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
    market_id: undefined as string | undefined,
  });
  const field = (label: string, value: string, onChange: (v: string) => void, extra: any = {}) => (
    <Field label={label} value={value} onChangeText={onChange} {...extra} />
  );
  return (
    <>
      <Text style={s.eyebrow}>{t('sell.eyebrow')}</Text>
      <Text style={s.heading}>{seller ? seller.business_name : 'Meet your next customer.'}</Text>
      {seller && <SellerLocationPanel seller={seller} onSaved={refresh} />}
      {seller && seller.status !== 'REJECTED' && <VerificationDocuments />}
      {!seller || seller.status === 'REJECTED' ? (
        <>
          <Text style={s.subtitle}>
            {seller?.reason
              ? `Application feedback: ${seller.reason}`
              : 'Tell us about your business. An administrator will review your application before you can publish.'}
          </Text>
          {field('Business name', profile.business_name, (v) =>
            setProfile({ ...profile, business_name: v }),
          )}
          <Text style={s.label}>Business type</Text>
          <View style={s.chipWrap}>
            {['farm', 'shop', 'market_stall', 'home_based'].map((type) => (
              <Chip
                key={type}
                title={statusLabel(type)}
                active={profile.business_type === type}
                onPress={() => setProfile({ ...profile, business_type: type })}
              />
            ))}
          </View>
          {field('City', profile.city, (v) => setProfile({ ...profile, city: v }))}
          {field('Area / community', profile.area, (v) => setProfile({ ...profile, area: v }))}
          {field(
            'Private collection address',
            profile.address,
            (v) => setProfile({ ...profile, address: v }),
            {
              multiline: true,
              placeholder: 'Street, landmark, stall or collection point',
            },
          )}
          <LocationPicker
            value={{
              latitude: profile.latitude,
              longitude: profile.longitude,
              market_id: profile.market_id,
            }}
            onChange={(pin) => setProfile({ ...profile, ...pin })}
          />
          <Text style={s.fine}>
            Only your city and area appear publicly. Accepted buyers can access your collection
            address during their reservation.
          </Text>
          <Button
            title="Submit for approval →"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await api('/sellers', 'POST', profile);
              }, 'Your seller application has been submitted.')
            }
          />
        </>
      ) : seller.status !== 'APPROVED' ? (
        <View style={s.orderCard}>
          <Badge status={seller.status} />
          <Text style={s.sectionTitle}>
            {seller.status === 'PENDING'
              ? 'Your growing journey starts here'
              : 'Your seller account is suspended'}
          </Text>
          <Text style={s.body}>
            {seller.reason ||
              'Our team is reviewing your business and collection details. Pull down to refresh your approval status.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={s.sellerStrip}>
            <Badge status="APPROVED" />
            <Text style={s.small}>
              {seller.area}, {seller.city} · {settings ? settings.commission_bps / 100 : 5}%
              commission
            </Text>
          </View>
          <View style={s.inlineActions}>
            <Button
              secondary
              title={t('sell.viewShop')}
              onPress={() => openSeller(seller.user_id)}
            />
            <Button
              secondary
              title={t('sell.shareShop')}
              onPress={() => void shareOnWhatsApp(shopMessage(seller))}
            />
          </View>
          <SellerAnalytics refreshVersion={incoming.length + mine.length} />
          <Button title={t('sell.addProduce')} onPress={() => onEditListing(null)} />
          <Text style={s.sectionTitle}>{t('sell.listings')}</Text>
          {mine.length ? (
            mine.map((l) => (
              <View key={l.id} style={s.orderCard}>
                <View style={s.rowBetween}>
                  <Text style={s.cardTitle}>{l.title}</Text>
                  <Badge status={l.status} />
                </View>
                <Text style={s.body}>
                  {money(l.price_kobo)} / {l.unit} · {l.stock} available
                </Text>
                <View style={s.inlineActions}>
                  <Button secondary title="Edit stock & price" onPress={() => onEditListing(l)} />
                  <Button
                    secondary
                    disabled={busy}
                    title={l.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    onPress={() =>
                      void run(
                        () =>
                          api(`/listings/${l.id}`, 'PATCH', {
                            status: l.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                          }),
                        'Listing visibility updated.',
                      )
                    }
                  />
                </View>
                <PromoteListing listing={l} />
              </View>
            ))
          ) : (
            <Empty
              title="Make your first listing"
              text="Add your produce, price and stock to start reaching local buyers."
            />
          )}
          <Text style={s.sectionTitle}>{t('sell.incoming')}</Text>
          {incoming.length ? (
            incoming.map((b) => <BookingCard key={b.id} booking={b} isSeller />)
          ) : (
            <Text style={s.muted}>Buyer requests will appear here.</Text>
          )}
        </>
      )}
    </>
  );
}
