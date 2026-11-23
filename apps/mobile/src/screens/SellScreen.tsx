import ProfileDetailsPanel from '../ProfileDetailsPanel';
import LocalStatusPublisher from '../LocalStatusPublisher';
import { money, statusLabel, type Booking, type Listing, type Seller } from '@ahia/shared';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { featureOn } from '../features';
import { useI18n } from '../i18n';
import { LocationPicker, SellerLocationPanel } from '../LocationEditor';
import { request } from '../request';
import SellerAnalytics from '../SellerAnalytics';
import { VerificationDocuments } from '../SellerTools';
import { FeatureShop, PromoteWithPackage, VerificationPanel } from '../BusinessTools';
import { shareOnWhatsApp, shopMessage } from '../share';
import { Badge, Button, Chip, Empty, Field, s } from '../ui';
import BookingCard from './BookingCard';

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
  const [docVersion, setDocVersion] = useState(0);
  const [profile, setProfile] = useState({
    business_name: '',
    state: '',
    lga: '',
    business_type: 'individual' as Seller['business_type'],
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
      {seller && <ProfileDetailsPanel subject="seller" />}
      {seller && seller.status !== 'REJECTED' && (
        <VerificationDocuments version={docVersion} onChange={() => setDocVersion((v) => v + 1)} />
      )}
      {seller?.status === 'APPROVED' && (
        <VerificationPanel version={docVersion} onDocuments={() => setDocVersion((v) => v + 1)} />
      )}
      {seller?.status === 'APPROVED' && featureOn(settings, 'promotions') && <FeatureShop />}
      {!seller || seller.status === 'REJECTED' ? (
        <>
          <Text style={s.subtitle}>
            {seller?.reason
              ? `Application feedback: ${seller.reason}`
              : 'Tell us about your business. An administrator will review your application before you can publish.'}
          </Text>
          {field('Shop or seller name', profile.business_name, (v) =>
            setProfile({ ...profile, business_name: v }),
          )}
          <Text style={s.label}>Seller type</Text>
          <View style={s.chipWrap}>
            {(
              (settings?.catalog?.seller_types || [
                'individual',
                'shop',
                'farm',
              ]) as Seller['business_type'][]
            ).map((type) => (
              <Chip
                key={type}
                title={statusLabel(type)}
                active={profile.business_type === type}
                onPress={() => setProfile({ ...profile, business_type: type })}
              />
            ))}
          </View>
          {field('State', profile.state, (v) => setProfile({ ...profile, state: v }))}
          {field('Local Government Area (LGA)', profile.lga, (v) =>
            setProfile({ ...profile, lga: v }),
          )}
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
                await request('post', '/sellers', { body: profile });
              }, 'Your seller application has been submitted.')
            }
          />
        </>
      ) : seller.status !== 'APPROVED' ? (
        <View style={s.orderCard}>
          <Badge status={seller.status} />
          <Text style={s.sectionTitle}>
            {seller.status === 'PENDING'
              ? 'Your selling journey starts here'
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
          {featureOn(settings, 'local_status') && <LocalStatusPublisher />}
          <SellerAnalytics refreshVersion={incoming.length + mine.length} />
          <Button title={t('sell.addProduce')} onPress={() => onEditListing(null)} />
          <Text style={s.sectionTitle}>{t('sell.listings')}</Text>
          <Text style={s.fine}>
            Archived listings stay in your history. Restore them, then edit and publish when ready.
          </Text>
          {mine.length ? (
            mine.map((l) => (
              <View key={l.id} style={s.orderCard}>
                <View style={s.rowBetween}>
                  <Text style={s.cardTitle}>{l.title}</Text>
                  <Badge status={l.status} />
                  <Text style={s.fine}>
                    Stock checked {new Date(l.confirmed_at).toLocaleDateString()}
                  </Text>
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
                          request('patch', '/listings/{id}', {
                            params: { id: l.id },
                            body: {
                              status: l.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                            },
                          }),
                        'Listing visibility updated.',
                      )
                    }
                  />
                </View>
                <Button
                  secondary
                  title="Reconfirm current stock"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/listings/{id}/confirm-stock', {
                        params: { id: l.id },
                      });
                    }, 'Stock reconfirmed.')
                  }
                />
                <Button
                  secondary
                  title={l.archived_at ? 'Restore archived listing' : 'Archive listing'}
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/listings/{id}/archive', {
                        params: { id: l.id },
                        body: { archived: !l.archived_at },
                      });
                    }, 'Catalogue entry updated; restored items stay paused until published.')
                  }
                />
                <Button
                  secondary
                  title={
                    l.preorder_advance_allowed
                      ? 'Disable pre-order advance payments'
                      : 'Preview accepting pre-order advances'
                  }
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('put', '/listings/{id}/advance-preference', {
                        params: { id: l.id },
                        body: { allowed: !l.preorder_advance_allowed },
                      });
                    }, 'Pre-order payment preference updated; enabling advances is simulation-only until provider approval.')
                  }
                />
                <Text style={s.small}>
                  Ahia fee for {l.category}:{' '}
                  {((settings?.catalog as any)?.commission_rates?.[l.category] ??
                    settings?.commission_bps ??
                    500) / 100}
                  % of each completed order
                </Text>
                {featureOn(settings, 'promotions') && <PromoteWithPackage listing={l} />}
              </View>
            ))
          ) : (
            <Empty
              title="Create your first listing"
              text="Add your products, prices and stock to start reaching local buyers."
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
