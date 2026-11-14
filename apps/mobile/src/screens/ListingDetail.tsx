import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { View, Text, ScrollView, Image } from 'react-native';
import { money, type Listing } from '@farmers-market/shared';
import { api } from '../api';
import { SellerTrust } from '../TrustPanels';
import { Field, Button, Chip, Badge, Empty, Back, s, produceIcon, categories } from '../ui';
import { useApp } from '../AppContext';
import { useI18n } from '../i18n';

export default function ListingDetail({
  listing: selected,
  onBack,
  initialVariantId,
  initialQuantity,
}: {
  listing: Listing;
  onBack: () => void;
  initialVariantId?: string;
  initialQuantity?: number;
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
  return (
    <>
      <Back onPress={onBack} />
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
        <Text style={s.eyebrow}>{selected.category.toUpperCase()} · LOCALLY GROWN</Text>
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
              const c = await api('/conversations', 'POST', { listing_id: selected.id });
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
            Book now and the seller holds it for you from the harvest date. Pay once the seller
            accepts.
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
                const r = await api(
                  `/listings/${selected.id}/stock-alert`,
                  alerted ? 'DELETE' : 'PUT',
                );
                setAlerted(r.stock_alert);
              })
            }
          />
        </View>
      )}
      <Field
        label={t('listing.quantity', { unit: selectedVariant?.unit || selected.unit })}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
      />
      <View style={s.rowBetween}>
        <Text style={s.muted}>{t('listing.total')}</Text>
        <Text style={s.price}>{money(selectedPrice * (Number(quantity) || 0))}</Text>
      </View>
      <Button
        title={busy ? 'Requesting…' : t('listing.request')}
        disabled={
          busy ||
          selected.seller_id === me.id ||
          !Number.isInteger(Number(quantity)) ||
          Number(quantity) < (selectedVariant?.min_quantity || 1) ||
          Number(quantity) > limit
        }
        onPress={() =>
          void run(async () => {
            await api('/bookings', 'POST', {
              listing_id: selected.id,
              variant_id: selectedVariant?.id,
              quantity: Number(quantity),
            });
            setTab('Bookings');
          }, 'Request sent. The seller will confirm stock before reserving it.')
        }
      />
      <Text style={s.fine}>{t('listing.noCharge')}</Text>
    </>
  );
}
