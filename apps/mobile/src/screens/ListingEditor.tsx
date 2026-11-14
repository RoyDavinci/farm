import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image } from 'react-native';
import type { Listing } from '@farmers-market/shared';
import * as ImagePicker from 'expo-image-picker';
import { api, uploadPhoto } from '../api';
import { drafts, withRetry } from '../offline';
import VariantEditor, { newVariant, variantDraft, serializeVariants } from '../VariantEditor';
import { Field, Button, Chip, Badge, Empty, Back, s, produceIcon, categories } from '../ui';
import { useApp } from '../AppContext';

const blankListing = {
  title: '',
  description: '',
  category: 'Vegetables',
  unit: 'kg',
  price: '',
  stock: '',
  image_url: '',
  image_urls: [] as string[],
  variants: [newVariant()],
  harvest: '',
  preorder: '',
};
function draftFrom(l: Listing): typeof blankListing {
  return {
    title: l.title,
    description: l.description,
    category: l.category,
    unit: l.unit,
    price: String(l.price_kobo / 100),
    stock: String(l.stock),
    variants: l.variants?.length
      ? l.variants.map(variantDraft)
      : [
          {
            ...newVariant(),
            unit: l.unit,
            price: String(l.price_kobo / 100),
            stock: String(l.stock),
          },
        ],
    image_url: '',
    image_urls: l.image_urls?.length ? l.image_urls : l.image_url ? [l.image_url] : [],
    harvest:
      l.available_from && new Date(l.available_from).getTime() > Date.now()
        ? l.available_from.slice(0, 10)
        : '',
    preorder: l.preorder_capacity ? String(l.preorder_capacity) : '',
  };
}
export default function ListingEditor({
  listing,
  onDone,
}: {
  listing: Listing | null;
  onDone: () => void;
}) {
  const { busy, run } = useApp();
  const editingId = listing?.id ?? null;
  const [draft, setDraft] = useState(() => (listing ? draftFrom(listing) : blankListing));
  // New listings are saved as a local draft so nothing is lost if the app closes or goes offline.
  const draftKey = `listing:${listing?.id || 'new'}`;
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void drafts.load<typeof blankListing>(draftKey).then((saved) => {
      if (saved && !listing) setDraft({ ...blankListing, ...saved });
      setRestored(true);
    });
  }, [draftKey]);
  useEffect(() => {
    if (restored && !listing) drafts.save(draftKey, draft);
  }, [draft, restored]);
  const field = (label: string, value: string, onChange: (v: string) => void, extra: any = {}) => (
    <Field label={label} value={value} onChangeText={onChange} {...extra} />
  );
  async function choosePhotos(camera = false) {
    await run(async () => {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error('Camera permission is needed to take a produce photo.');
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: !camera,
        selectionLimit: Math.max(1, 6 - draft.image_urls.length),
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const urls: string[] = [];
      for (const asset of result.assets.slice(0, 6 - draft.image_urls.length)) {
        const uploaded = await withRetry(() => uploadPhoto(asset));
        urls.push(uploaded.url);
      }
      setDraft((current) => ({
        ...current,
        image_urls: [...current.image_urls, ...urls].slice(0, 6),
      }));
    });
  }
  return (
    <>
      <Back onPress={onDone} />
      <Text style={s.heading}>{editingId ? 'Update your produce' : 'Something fresh to sell'}</Text>
      <Text style={s.subtitle}>Prices and available stock take effect immediately.</Text>
      {field('Produce name', draft.title, (v) => setDraft({ ...draft, title: v }))}
      {field('Description', draft.description, (v) => setDraft({ ...draft, description: v }), {
        multiline: true,
      })}
      {field(
        'Photo URL (optional HTTPS link)',
        draft.image_url,
        (v) => setDraft({ ...draft, image_url: v }),
        { autoCapitalize: 'none', keyboardType: 'url' },
      )}
      <Text style={s.label}>Produce photos ({draft.image_urls.length}/6)</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 10 }}>
        {draft.image_urls.map((url) => (
          <View key={url} style={{ gap: 6 }}>
            <Image source={{ uri: url }} style={{ width: 90, height: 90, borderRadius: 8 }} />
            <Pressable
              disabled={busy}
              onPress={() =>
                setDraft((current) => ({
                  ...current,
                  image_urls: current.image_urls.filter((u) => u !== url),
                }))
              }
            >
              <Text style={s.link}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <View style={s.inlineActions}>
        <Button
          secondary
          title="Choose photos"
          disabled={busy || draft.image_urls.length >= 6}
          onPress={() => void choosePhotos()}
        />
        <Button
          secondary
          title="Take photo"
          disabled={busy || draft.image_urls.length >= 6}
          onPress={() => void choosePhotos(true)}
        />
      </View>
      <Text style={s.label}>Category</Text>
      <View style={s.chipWrap}>
        {categories.slice(1).map((c) => (
          <Chip
            key={c}
            title={c}
            active={draft.category === c}
            onPress={() => setDraft({ ...draft, category: c })}
          />
        ))}
      </View>
      <View style={s.orderCard}>
        <Text style={s.label}>Pre-orders (optional)</Text>
        <Text style={s.fine}>
          Not harvested yet? Set the date it will be ready and how many units buyers may pre-order.
          Collection holds start from that date.
        </Text>
        {field(
          'Ready from (YYYY-MM-DD)',
          draft.harvest,
          (v) => setDraft({ ...draft, harvest: v }),
          {
            placeholder: 'e.g. 2026-12-20',
            autoCapitalize: 'none',
          },
        )}
        {field(
          'Units available for pre-order',
          draft.preorder,
          (v) => setDraft({ ...draft, preorder: v.replace(/\D/g, '') }),
          { keyboardType: 'number-pad' },
        )}
      </View>
      <VariantEditor
        value={draft.variants}
        onChange={(variants) => setDraft({ ...draft, variants })}
      />
      <Button
        title="Save listing"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            const variants = serializeVariants(draft.variants);
            const primary = variants.find((v) => v.active);
            if (!primary) throw new Error('Keep at least one active product option.');
            let available_from: string | null = null;
            if (draft.harvest.trim()) {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.harvest.trim()))
                throw new Error('Enter the ready date as YYYY-MM-DD.');
              available_from = new Date(`${draft.harvest.trim()}T08:00:00`).toISOString();
            }
            const body = {
              available_from,
              preorder_capacity: available_from ? Number(draft.preorder || 0) : 0,
              title: draft.title,
              description: draft.description,
              category: draft.category,
              unit: primary.unit,
              price_kobo: primary.price_kobo,
              stock: primary.stock,
              variants,
              image_url: draft.image_url.trim() || null,
              image_urls: draft.image_urls.length
                ? draft.image_urls
                : draft.image_url.trim()
                  ? [draft.image_url.trim()]
                  : [],
            };
            await api(
              editingId ? `/listings/${editingId}` : '/listings',
              editingId ? 'PATCH' : 'POST',
              body,
            );
            drafts.clear(draftKey);
            onDone();
          }, 'Listing saved. Stock is confirmed immediately.')
        }
      />
    </>
  );
}
