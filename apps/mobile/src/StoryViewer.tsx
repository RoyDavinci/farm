import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { money, type LocalStatus } from '@ahia/shared';
import { useApp } from './AppContext';
import { request } from './request';
import StatusVideo from './StatusVideo';

const PHOTO_MS = 5000;

function ago(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
}

/**
 * Full-screen stories: progress bars per seller, auto-advance (photos after 5 s, videos after
 * their length), tap the left side to go back and the right side to go forward. The product sits
 * at the bottom; mute and report are under the ⋯ menu.
 */
export default function StoryViewer({
  stories,
  startId,
  scope,
  onSeen,
  onClose,
  onMuted,
}: {
  stories: LocalStatus[];
  startId: string | null;
  scope: Record<string, unknown>;
  onSeen: (id: string) => void;
  onClose: () => void;
  onMuted: () => void;
}) {
  const { openListing } = useApp();
  const [index, setIndex] = useState(-1),
    [menu, setMenu] = useState(false),
    [reporting, setReporting] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setIndex(startId ? stories.findIndex((s) => s.id === startId) : -1);
  }, [startId]); // eslint-disable-line react-hooks/exhaustive-deps

  const story = index >= 0 ? stories[index] : undefined;
  const group = story ? stories.filter((s) => s.seller_id === story.seller_id) : [];
  const position = story ? group.findIndex((s) => s.id === story.id) : 0;
  const paused = menu || reporting || busy;

  const close = () => {
    setMenu(false);
    setReporting(false);
    setNotice('');
    onClose();
  };
  const go = (step: number) => {
    const next = index + step;
    if (next < 0) return;
    if (next >= stories.length) return close();
    setMenu(false);
    setReporting(false);
    setIndex(next);
  };

  // Record the view and mark the story as watched.
  useEffect(() => {
    if (!story) return;
    onSeen(story.id);
    void request('post', '/local-status/{id}/events', {
      params: { id: story.id },
      query: scope as any,
      body: { kind: 'view' },
    }).catch(() => {});
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress bar and auto-advance: a small timer that pauses with the menu or a report.
  const elapsed = useRef(0),
    shownId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!story) return;
    if (shownId.current !== story.id) {
      shownId.current = story.id;
      elapsed.current = 0;
      progress.setValue(0);
    }
    if (paused) return;
    const total =
      story.media_type === 'VIDEO'
        ? Math.max(3000, (story.duration_seconds || 15) * 1000)
        : PHOTO_MS;
    const timer = setInterval(() => {
      elapsed.current += 50;
      progress.setValue(Math.min(1, elapsed.current / total));
      if (elapsed.current >= total) {
        clearInterval(timer);
        go(1);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [story?.id, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const openProduct = async () => {
    if (!story) return;
    setBusy(true);
    try {
      const click = await request('post', '/local-status/{id}/events', {
        params: { id: story.id },
        query: scope as any,
        body: { kind: 'click' },
      });
      const listing = await request('get', '/listings/{id}', { params: { id: story.listing_id } });
      close();
      openListing(listing, { attributionToken: click.attribution_token || undefined });
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const mute = async (kind: 'SELLER' | 'CATEGORY', target: string) => {
    setBusy(true);
    try {
      await request('put', '/local-status/preferences', { body: { kind, target, muted: true } });
      setMenu(false);
      onMuted();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const report = async () => {
    if (!story) return;
    setBusy(true);
    try {
      await request('post', '/local-status/{id}/report', {
        params: { id: story.id },
        query: scope as any,
        body: { reason },
      });
      setReporting(false);
      setReason('');
      setNotice('Thanks. Our team will review this story.');
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!story} animationType="fade" onRequestClose={close} transparent={false}>
      <View style={styles.screen}>
        {story && (
          <>
            {story.media_type === 'VIDEO' ? (
              <View style={styles.media}>
                <StatusVideo uri={story.media_url} />
              </View>
            ) : (
              <Image source={{ uri: story.media_url }} style={styles.media} resizeMode="contain" />
            )}

            {/* Tap zones: left third back, the rest forward. */}
            <View style={styles.zones}>
              <Pressable
                accessibilityLabel="Previous story"
                style={{ flex: 1 }}
                onPress={() => go(-1)}
              />
              <Pressable
                accessibilityLabel="Next story"
                style={{ flex: 2 }}
                onPress={() => go(1)}
              />
            </View>

            <SafeAreaView style={styles.topWrap}>
              <View style={styles.top}>
                <View style={styles.bars}>
                  {group.map((g, i) => (
                    <View key={g.id} style={styles.bar}>
                      <Animated.View
                        style={[
                          styles.barFill,
                          {
                            width:
                              i < position
                                ? '100%'
                                : i > position
                                  ? '0%'
                                  : progress.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: ['0%', '100%'],
                                    }),
                          },
                        ]}
                      />
                    </View>
                  ))}
                </View>
                <View style={styles.header}>
                  <Image source={{ uri: story.thumbnail_url }} style={styles.headAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.headName}>
                      {story.business_name}
                    </Text>
                    <Text numberOfLines={1} style={styles.headMeta}>
                      {ago(story.created_at)} · {story.area}
                      {story.distance_km != null ? ` · ${story.distance_km} km` : ''}
                      {story.sponsored ? ' · Sponsored' : ''}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Story options"
                    hitSlop={10}
                    onPress={() => setMenu(!menu)}
                  >
                    <Text style={styles.icon}>⋯</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close stories"
                    hitSlop={10}
                    onPress={close}
                  >
                    <Text style={styles.icon}>✕</Text>
                  </Pressable>
                </View>
                {menu && (
                  <View style={styles.menu}>
                    <Pressable onPress={() => void mute('SELLER', story.seller_id)}>
                      <Text style={styles.menuItem}>Mute {story.business_name}</Text>
                    </Pressable>
                    <Pressable onPress={() => void mute('CATEGORY', story.category)}>
                      <Text style={styles.menuItem}>Mute {story.category}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setMenu(false);
                        setReporting(true);
                      }}
                    >
                      <Text style={[styles.menuItem, { color: '#f0a090' }]}>Report story</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </SafeAreaView>

            <SafeAreaView style={styles.bottomWrap}>
              <View style={styles.bottom}>
                {!!story.caption && <Text style={styles.caption}>{story.caption}</Text>}
                {!!notice && <Text style={styles.notice}>{notice}</Text>}
                {reporting ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Why are you reporting this story?"
                      placeholderTextColor="#969ba9"
                      style={styles.input}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        style={[styles.cta, { flex: 1 }]}
                        disabled={busy || reason.trim().length < 5}
                        onPress={() => void report()}
                      >
                        <Text style={styles.ctaText}>Send report</Text>
                      </Pressable>
                      <Pressable style={styles.ghost} onPress={() => setReporting(false)}>
                        <Text style={styles.ghostText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.product}
                    disabled={busy}
                    onPress={() => void openProduct()}
                  >
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.productTitle}>
                        {story.title}
                      </Text>
                      <Text style={styles.productPrice}>
                        {money(story.price_kobo)} / {story.unit}
                      </Text>
                    </View>
                    <View style={styles.cta}>
                      <Text style={styles.ctaText}>View product</Text>
                    </View>
                  </Pressable>
                )}
              </View>
            </SafeAreaView>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1124' },
  media: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
  },
  zones: { position: 'absolute', top: 90, left: 0, right: 0, bottom: 150, flexDirection: 'row' },
  topWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  top: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 10,
  },
  bars: { flexDirection: 'row', gap: 4 },
  bar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  barFill: { height: 3, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#fff',
    backgroundColor: '#1d2742',
  },
  headName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  headMeta: { color: 'rgba(255, 255, 255, 0.75)', fontSize: 12 },
  icon: { color: '#fff', fontSize: 22, paddingHorizontal: 6 },
  menu: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(16, 21, 34, 0.96)',
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 210,
  },
  menuItem: { color: '#fff', fontSize: 14, paddingVertical: 11, paddingHorizontal: 16 },
  bottom: { padding: 14, paddingBottom: 18, gap: 10 },
  caption: { color: '#fff', fontSize: 15, lineHeight: 21 },
  notice: { color: '#fbcf82', fontSize: 13 },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    padding: 12,
  },
  productTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  productPrice: { color: 'rgba(255, 255, 255, 0.85)', fontSize: 13, marginTop: 2 },
  cta: {
    backgroundColor: '#f5a524',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  ctaText: { color: '#161e33', fontWeight: '800', fontSize: 14 },
  ghost: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  ghostText: { color: '#fff', fontWeight: '700' },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    color: '#fff',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
  },
});
