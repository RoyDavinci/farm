import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { money, type Listing } from '@ahia/shared';
import { uploadPhoto, uploadStatusVideo } from './api';
import { request } from './request';
import StatusVideo from './StatusVideo';
import { useApp } from './AppContext';

type Media = { url: string; kind: 'IMAGE' | 'VIDEO' } | null;

/**
 * The quick way for a seller to post a status: take a photo or pick one (or a short video),
 * tap the product it is about, add a caption and post. Opens full screen from "Add status" on
 * Market and from the Sell tab.
 */
export default function StatusComposer({
  visible,
  onClose,
  onPosted,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const { settings } = useApp();
  const [listings, setListings] = useState<Listing[] | null>(null),
    [listingId, setListingId] = useState(''),
    [media, setMedia] = useState<Media>(null),
    [caption, setCaption] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setError('');
    void request('get', '/listings', { query: { mine: 'true' } })
      .then((rows: Listing[]) => {
        const active = rows.filter((l) => l.status === 'ACTIVE');
        setListings(active);
        // Start with the newest product so a one-product seller never has to choose.
        setListingId((id) => (active.some((l) => l.id === id) ? id : active[0]?.id || ''));
      })
      .catch((e) => setError(e.message));
  }, [visible]);

  const listing = listings?.find((l) => l.id === listingId);
  const preview = media?.url || listing?.image_url || '';

  const reset = () => {
    setMedia(null);
    setCaption('');
    setError('');
  };
  const close = () => {
    reset();
    onClose();
  };

  async function pick(source: 'camera' | 'library') {
    setError('');
    try {
      if (source === 'camera' && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Allow camera access to take a status photo.');
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: source === 'camera' ? ['images'] : ['images', 'videos'],
        quality: 0.85,
        videoMaxDuration: 30,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.type === 'video') {
        if ((asset.fileSize || 0) > 20 * 1024 * 1024)
          throw new Error('Choose a video under 20 MB.');
        if ((asset.duration || 0) > 30000) throw new Error('Choose a video up to 30 seconds.');
        setBusy('Preparing your video…');
        setMedia({ url: (await uploadStatusVideo(asset)).url, kind: 'VIDEO' });
      } else {
        if ((asset.fileSize || 0) > 5 * 1024 * 1024) throw new Error('Choose a photo under 5 MB.');
        setBusy('Uploading your photo…');
        setMedia({ url: (await uploadPhoto(asset)).url, kind: 'IMAGE' });
      }
    } catch (e: any) {
      setError(e.message || 'That didn’t upload. Please try again.');
    } finally {
      setBusy('');
    }
  }

  async function post() {
    if (!listing) return;
    setBusy('Posting…');
    setError('');
    try {
      await request('post', '/local-status', {
        body: { listing_id: listing.id, caption, ...(media ? { media_url: media.url } : {}) },
      });
      reset();
      onPosted?.();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            onPress={close}
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
          <Text style={styles.title}>New status</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {listings && !listings.length ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Add a product first</Text>
              <Text style={styles.muted}>
                Each status links to one of your products, so buyers can order straight from it.
                List a product on the Sell tab, then come back.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.previewBox}>
                {preview ? (
                  media?.kind === 'VIDEO' ? (
                    <StatusVideo uri={preview} />
                  ) : (
                    <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
                  )
                ) : (
                  <Text style={styles.muted}>Take or choose a photo</Text>
                )}
                {!media && !!preview && (
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>Product photo</Text>
                  </View>
                )}
                {!!busy && (
                  <View style={styles.busy}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.busyText}>{busy}</Text>
                  </View>
                )}
              </View>

              <View style={styles.sources}>
                <Pressable
                  accessibilityRole="button"
                  style={styles.source}
                  disabled={!!busy}
                  onPress={() => void pick('camera')}
                >
                  <Text style={styles.sourceIcon}>📷</Text>
                  <Text style={styles.sourceText}>Camera</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={styles.source}
                  disabled={!!busy}
                  onPress={() => void pick('library')}
                >
                  <Text style={styles.sourceIcon}>🖼️</Text>
                  <Text style={styles.sourceText}>Photo or video</Text>
                </Pressable>
                {!!media && (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.source}
                    disabled={!!busy}
                    onPress={() => setMedia(null)}
                  >
                    <Text style={styles.sourceIcon}>↺</Text>
                    <Text style={styles.sourceText}>Product photo</Text>
                  </Pressable>
                )}
              </View>

              <Text style={styles.label}>Which product is this about?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.products}>
                  {(listings || []).map((l) => (
                    <Pressable
                      key={l.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: l.id === listingId }}
                      style={[styles.product, l.id === listingId && styles.productOn]}
                      onPress={() => setListingId(l.id)}
                    >
                      {l.image_url ? (
                        <Image source={{ uri: l.image_url }} style={styles.productImage} />
                      ) : (
                        <View style={[styles.productImage, styles.noImage]}>
                          <Text style={{ fontSize: 26 }}>🛍️</Text>
                        </View>
                      )}
                      <Text numberOfLines={1} style={styles.productTitle}>
                        {l.title}
                      </Text>
                      <Text style={styles.productPrice}>{money(l.price_kobo)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <TextInput
                value={caption}
                onChangeText={setCaption}
                maxLength={500}
                multiline
                placeholder="Add a caption — e.g. Fresh tomatoes just arrived 🍅"
                placeholderTextColor="#8aa396"
                style={styles.caption}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                accessibilityRole="button"
                style={[styles.post, (!listing || !preview || !!busy) && { opacity: 0.5 }]}
                disabled={!listing || !preview || !!busy}
                onPress={() => void post()}
              >
                <Text style={styles.postText}>Post status</Text>
              </Pressable>
              <Text style={styles.fine}>
                Buyers near you see it for {settings?.status_lifetime_hours || 24} hours. Photos up
                to 5 MB; videos up to 30 seconds and 20 MB.
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6faf7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  close: { fontSize: 22, color: '#0c3a25', width: 28 },
  title: { fontSize: 17, fontWeight: '800', color: '#0c3a25' },
  body: { padding: 16, paddingTop: 4, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  previewBox: {
    height: 340,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#dfeae3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { width: '100%', height: '100%' },
  tag: {
    position: 'absolute',
    left: 12,
    top: 12,
    backgroundColor: 'rgba(12,58,37,0.75)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  busy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  busyText: { color: '#fff', fontWeight: '700' },
  sources: { flexDirection: 'row', gap: 10 },
  source: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#dce8e0',
  },
  sourceIcon: { fontSize: 22 },
  sourceText: { fontWeight: '700', color: '#0c3a25', fontSize: 13 },
  label: { fontWeight: '800', color: '#0c3a25', fontSize: 15 },
  products: { flexDirection: 'row', gap: 10, paddingBottom: 4 },
  product: {
    width: 112,
    borderRadius: 14,
    padding: 6,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  productOn: { borderColor: '#1f754a' },
  productImage: { width: '100%', height: 80, borderRadius: 10 },
  noImage: { backgroundColor: '#e3eee7', alignItems: 'center', justifyContent: 'center' },
  productTitle: { fontWeight: '700', fontSize: 12, marginTop: 6, color: '#173326' },
  productPrice: { fontSize: 12, color: '#587667' },
  caption: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    minHeight: 70,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#dce8e0',
    textAlignVertical: 'top',
  },
  error: { color: '#b4362a', fontWeight: '600' },
  post: { backgroundColor: '#1f754a', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  postText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  fine: { fontSize: 12, color: '#6b8578', textAlign: 'center' },
  muted: { color: '#587667', textAlign: 'center', paddingHorizontal: 20 },
  empty: { padding: 24, gap: 8, alignItems: 'center' },
  emptyTitle: { fontWeight: '800', fontSize: 17, color: '#0c3a25' },
});
