import PublicSellerInfo from '../PublicSellerInfo';
import { money, type Listing } from '@ahia/shared';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppContext';
import { useI18n } from '../i18n';
import { request } from '../request';
import { SellerTrust } from '../TrustPanels';
import AllergenReport, { isFood } from '../AllergenReport';
import { Back, Button, Chip, produceIcon, s } from '../ui';

export default function ListingDetail({
  listing: selected,
  onBack,
  initialVariantId,
  initialQuantity,
  attributionToken,
}: {
  listing: Listing;
  onBack: () => void;
  initialVariantId?: string;
  initialQuantity?: number;
  attributionToken?: string;
}) {
  const { me, busy, run, openConversation, openSeller, setTab } = useApp();
  const initial =
    selected.variants?.find((v) => v.id === initialVariantId && v.active) ||
    selected.variants?.find((v) => v.active && v.stock >= v.min_quantity);
  const [variantId, setVariantId] = useState<string | undefined>(initial?.id);
  const [quantity, setQuantity] = useState(
    String(Math.max(initialQuantity || 0, initial?.min_quantity || 1)),
  );
  const [alerted, setAlerted] = useState(!!selected.stock_alert);
  const { t } = useI18n();
  const selectedVariant =
    selected?.variants?.find((v) => v.id === variantId) ||
    selected?.variants?.find((v) => v.active);
  let selectedPrice = selectedVariant?.price_kobo || selected?.price_kobo || 0;
  for (const tier of [...(selectedVariant?.wholesale_tiers || [])].sort(
    (a, b) => a.min_quantity - b.min_quantity,
  )) {
    if (Number(quantity) >= tier.min_quantity) selectedPrice = tier.price_kobo;
  }
  const preorder =
    !!selected.available_from && new Date(selected.available_from).getTime() > Date.now();
  // Before harvest, buyers book against the seller's pre-order capacity instead of stock.
  const limit = preorder
    ? selected.preorder_capacity || 0
    : (selectedVariant?.stock ?? selected.stock);
  const available = limit >= (selectedVariant?.min_quantity || 1);
  const own = selected.seller_id === me.id;
  const minimum = selectedVariant?.min_quantity || 1;
  const unit = selectedVariant?.unit || selected.unit;
  const qty = Number(quantity);
  // Why ordering is blocked, shown under the buttons instead of a silently greyed-out button.
  const blocked = own
    ? 'This is your own product. Buyers order it from their accounts.'
    : !available
      ? 'This is out of stock right now.'
      : !quantity || !Number.isInteger(qty) || qty < 1
        ? 'Enter how many you want.'
        : qty < minimum
          ? `The minimum order is ${minimum} ${unit}.`
          : qty > limit
            ? `Only ${limit} ${unit} available. Lower the quantity.`
            : '';
  const [orderError, setOrderError] = useState('');
  const order = (fn: () => Promise<unknown>, message: string) =>
    void run(async () => {
      setOrderError('');
      try {
        await fn();
      } catch (e: any) {
        setOrderError(e.message || 'That didn’t go through. Please try again.');
        throw e;
      }
    }, message);
  return (
    <>
      <Back onPress={onBack} />
      <Text style={s.small}>
        {(selected.condition || 'NEW').toLowerCase()} · {selected.category}
      </Text>
      <View style={s.detailHero}>
        {selected.image_url ? (
          <Image
            source={{ uri: selected.image_url }}
            accessibilityLabel={selected.title}
            style={{ width: '100%', height: 220, borderRadius: 10 }}
            resizeMode="cover"
          />
        ) : (
          <Text style={s.detailEmoji}>{produceIcon(selected.category)}</Text>
        )}
        <Text style={s.eyebrow}>{selected.category.toUpperCase()} · AVAILABLE LOCALLY</Text>
      </View>
      {selected.image_urls && selected.image_urls.length > 1 && (
        <ScrollView horizontal contentContainerStyle={{ gap: 10 }}>
          {selected.image_urls.map((url) => (
            <Image
              key={url}
              source={{ uri: url }}
              style={{ width: 180, height: 150, borderRadius: 10 }}
            />
          ))}
        </ScrollView>
      )}
      <Text style={s.heading}>{selected.title}</Text>
      <Text style={s.small}>
        {selected.pickup_available ? 'Collection available' : 'Delivery only'}
        {selected.delivery_available ? ' · Rider delivery available' : ''}
      </Text>
      <PublicSellerInfo sellerId={selected.seller_id} />
      <Text style={s.price}>
        {money(selectedPrice)}{' '}
        <Text style={s.muted}>/ {selectedVariant?.unit || selected.unit}</Text>
      </Text>
      <Text style={s.body}>{selected.description}</Text>
      <View style={s.sellerInfo}>
        <Text style={s.bold}>{selected.business_name}</Text>
        <Text style={s.muted}>
          {selected.area}, {selected.city} · Approved seller
        </Text>
        <Text style={s.small}>Exact collection address is shared after acceptance.</Text>
        <Pressable onPress={() => openSeller(selected.seller_id)}>
          <Text style={s.link}>{t('listing.visitShop', { name: selected.business_name })}</Text>
        </Pressable>
      </View>
      <SellerTrust sellerId={selected.seller_id} />
      {selected.seller_id !== me.id && (
        <Button
          secondary
          title={t('listing.message')}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              const c = await request('post', '/conversations', {
                body: { listing_id: selected.id },
              });
              openConversation(c.id);
            })
          }
        />
      )}
      <Text style={s.label}>{t('listing.chooseOption')}</Text>
      <View style={s.chipWrap}>
        {selected.variants
          ?.filter((v) => v.active)
          .map((v) => (
            <Chip
              key={v.id}
              title={`${v.name} · ${money(v.price_kobo)}/${v.unit}`}
              active={selectedVariant?.id === v.id}
              onPress={() => {
                setVariantId(v.id);
                setQuantity(String(v.min_quantity));
              }}
            />
          ))}
      </View>
      {preorder && (
        <View style={s.locationBox}>
          <Text style={s.bold}>
            Pre-order · ready from {new Date(selected.available_from!).toDateString()}
          </Text>
          <Text style={s.small}>
            Book now and the seller holds it for you from the ready date. The seller chooses whether
            advance payment is accepted. Otherwise pay when stock becomes available.
          </Text>
        </View>
      )}
      <Text style={s.bold}>
        {limit} {selectedVariant?.unit || selected.unit}{' '}
        {preorder ? 'open for pre-order' : 'available'} · Minimum{' '}
        {selectedVariant?.min_quantity || 1}
      </Text>
      {selectedVariant?.wholesale_tiers.map((t) => (
        <Text key={t.min_quantity} style={s.small}>
          Buy {t.min_quantity}+ {selectedVariant.unit}: {money(t.price_kobo)} per unit
        </Text>
      ))}
      {!available && !own && (
        <View style={s.locationBox}>
          <Text style={s.bold}>{t('listing.outOfStock')}</Text>
          <Text style={s.small}>
            {alerted
              ? 'We’ll notify you as soon as the seller restocks.'
              : 'Get a notification when this is available to book again.'}
          </Text>
          <Button
            secondary
            title={alerted ? t('listing.stopAlert') : t('listing.notifyMe')}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const r = await request(alerted ? 'delete' : 'put', '/listings/{id}/stock-alert', {
                  params: { id: selected.id },
                });
                setAlerted(r.stock_alert);
              })
            }
          />
        </View>
      )}
      <Text style={s.label}>
        {t('listing.quantity', { unit: selectedVariant?.unit || selected.unit })}
      </Text>
      <View style={styles.qtyRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fewer"
          style={styles.qtyButton}
          onPress={() => setQuantity(String(Math.max(minimum, (Math.floor(qty) || minimum) - 1)))}
        >
          <Text style={styles.qtySign}>−</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Quantity"
          value={quantity}
          onChangeText={(v) => setQuantity(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          style={styles.qtyInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          style={styles.qtyButton}
          onPress={() =>
            setQuantity(String(Math.min(Math.max(limit, minimum), (Math.floor(qty) || 0) + 1)))
          }
        >
          <Text style={styles.qtySign}>+</Text>
        </Pressable>
      </View>
      <View style={s.rowBetween}>
        <Text style={s.muted}>{t('listing.total')}</Text>
        <Text style={s.price}>{money(selectedPrice * (Number(quantity) || 0))}</Text>
      </View>
      <Button
        title={busy ? 'Requesting…' : t('listing.request')}
        disabled={busy || !!blocked}
        onPress={() =>
          order(async () => {
            await request('post', '/bookings', {
              body: {
                listing_id: selected.id,
                variant_id: selectedVariant?.id,
                quantity: Number(quantity),
                ...(attributionToken ? { source_status_click_id: attributionToken } : {}),
              },
            });
            setTab('Bookings');
          }, 'Request sent. The seller will confirm stock before reserving it.')
        }
      />
      {!own && (
        <Button
          secondary
          title="Add to cart"
          disabled={busy || !!blocked}
          onPress={() =>
            order(async () => {
              await request('post', '/cart', {
                body: {
                  listing_id: selected.id,
                  variant_id: selectedVariant?.id,
                  quantity: Number(quantity),
                },
              });
            }, 'Added to your cart. Open the cart at the top to send all your requests at once.')
          }
        />
      )}
      {!!(blocked || orderError) && (
        <Text accessibilityRole="alert" style={styles.blocked}>
          {orderError || blocked}
        </Text>
      )}
      <Text style={s.fine}>{t('listing.noCharge')}</Text>
      {!own && isFood(selected.category) && (
        <>
          <Text style={s.fine}>
            Allergen information comes from the seller. Check the label or ask the seller before
            buying.
          </Text>
          <AllergenReport listingId={selected.id} />
        </>
      )}
      {!own && (
        <Button
          secondary
          title="Save interest without booking or paying"
          disabled={busy || !Number.isInteger(Number(quantity)) || Number(quantity) < 1}
          onPress={() =>
            void run(async () => {
              await request('post', '/listings/{id}/interest', {
                params: { id: selected.id },
                body: { quantity: Number(quantity) },
              });
            }, 'Interest saved. Review it under Bookings before confirming an order.')
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  qtyButton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#e3f0e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtySign: { fontSize: 26, fontWeight: '700', color: '#1f754a' },
  qtyInput: {
    flex: 1,
    minWidth: 0,
    width: 0,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d5e5db',
    backgroundColor: '#fff',
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#0c3a25',
  },
  blocked: {
    color: '#9b553c',
    backgroundColor: '#f9eade',
    borderRadius: 12,
    padding: 10,
    fontWeight: '600',
  },
});
