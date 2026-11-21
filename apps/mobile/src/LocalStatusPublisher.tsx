import StatusVideo from './StatusVideo';
import BoostStatusPanel from './BoostStatusPanel';
import { useCallback, useEffect, useState } from 'react';
import { Image, View, Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { type Listing, money } from '@zuru/shared';
import { useApp } from './AppContext';
import { uploadPhoto, uploadStatusVideo } from './api';
import { request } from './request';
import { Button, Chip, Field, s } from './ui';
export default function LocalStatusPublisher({ listings }: { listings: Listing[] }) {
  const { busy, run, settings } = useApp();
  const [open, setOpen] = useState(false),
    [listingId, setListingId] = useState(''),
    [caption, setCaption] = useState(''),
    [photo, setPhoto] = useState(''),
    [mediaKind, setMediaKind] = useState<'IMAGE' | 'VIDEO'>('IMAGE'),
    [rows, setRows] = useState<Awaited<ReturnType<typeof loadMine>>>([]);
  async function loadMine() {
    return request('get', '/local-status/mine');
  }
  const load = useCallback(() => loadMine().then(setRows), []);
  useEffect(() => {
    if (open) void load().catch(() => {});
  }, [open, load]);
  const listing = listings.find((l) => l.id === listingId),
    image = photo || listing?.image_url;
  return (
    <View style={s.orderCard}>
      <Text style={s.cardTitle}>Your Local Status</Text>
      <Text style={s.fine}>
        Share a photo or short video of an available product with local buyers. Updates expire after{' '}
        {settings?.status_lifetime_hours || 24} hours; the product listing stays active.
      </Text>
      <Button
        secondary
        title={open ? 'Close status publisher' : 'Publish / manage local updates'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={s.bold}>Link an existing product</Text>
          <View style={s.chipWrap}>
            {listings
              .filter((l) => l.status === 'ACTIVE')
              .map((l) => (
                <Chip
                  key={l.id}
                  title={l.title}
                  active={l.id === listingId}
                  onPress={() => {
                    setListingId(l.id);
                    setPhoto('');
                    setMediaKind('IMAGE');
                  }}
                />
              ))}
          </View>
          <Field
            label="Status caption"
            value={caption}
            onChangeText={setCaption}
            maxLength={500}
            multiline
          />
          {!!image &&
            (mediaKind === 'VIDEO' ? (
              <StatusVideo uri={image} />
            ) : (
              <Image
                source={{ uri: image }}
                accessibilityLabel="Status photo preview"
                style={{ height: 220, width: '100%', resizeMode: 'contain' }}
              />
            ))}
          <Button
            secondary
            title="Choose a status photo"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const selected = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  quality: 0.85,
                });
                if (selected.canceled) return;
                if (selected.assets[0].fileSize && selected.assets[0].fileSize > 5 * 1024 * 1024)
                  throw Error('Choose an image under 5 MB.');
                setPhoto((await uploadPhoto(selected.assets[0])).url);
                setMediaKind('IMAGE');
              })
            }
          />
          <Button
            secondary
            title="Choose a short status video"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const selected = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['videos'],
                  videoMaxDuration: 30,
                });
                if (selected.canceled) return;
                const asset = selected.assets[0];
                if ((asset.fileSize || 0) > 20 * 1024 * 1024)
                  throw new Error('Choose a video under 20 MB.');
                if ((asset.duration || 0) > 30000)
                  throw new Error('Choose a video up to 30 seconds.');
                const uploaded = await uploadStatusVideo(asset);
                setPhoto(uploaded.url);
                setMediaKind('VIDEO');
              }, 'Video processed and ready to preview.')
            }
          />
          <Text style={s.fine}>
            Photos: JPEG, PNG or WebP up to 5 MB. Videos: MP4, MOV or WebM up to 20 MB and 30
            seconds. Videos are compressed and get a preview image. Preview the media before
            publishing.
          </Text>
          <Button
            title="Publish Local Status"
            disabled={busy || !listing || !image}
            onPress={() =>
              void run(async () => {
                await request('post', '/local-status', {
                  body: { listing_id: listingId, caption, ...(photo ? { media_url: photo } : {}) },
                });
                setPhoto('');
                setMediaKind('IMAGE');
                setCaption('');
                await load();
              }, 'Your update is now live for local discovery.')
            }
          />
          <Text style={s.sectionTitle}>Recent updates & analytics</Text>
          <Text style={s.fine}>
            Repeat views and clicks within five minutes count once. Unique viewers are counted
            without exposing their identity. Bookings use a server-verified last product click
            within 24 hours; each click attributes at most one booking. Completed value is gross,
            before fees and refunds, and is not proof that the status caused the sale.
          </Text>
          {rows.map((row) => (
            <View key={row.id} style={s.locationBox}>
              <Text style={s.bold}>{row.title}</Text>
              <Text style={s.small}>{row.caption}</Text>
              <Text style={s.fine}>
                {row.status === 'ACTIVE' && new Date(row.expires_at).getTime() <= Date.now()
                  ? 'EXPIRED'
                  : row.status}{' '}
                · Expires {new Date(row.expires_at).toLocaleString()}
                {row.listing_available ? '' : ' · Product unavailable'}
              </Text>
              {row.moderation_reason && <Text style={s.fine}>{row.moderation_reason}</Text>}
              {row.analytics.map((a) => (
                <Text key={String(a.sponsored)} style={s.small}>
                  {a.sponsored ? 'Sponsored' : 'Organic'}: {a.views} views · {a.unique_viewers}{' '}
                  unique viewers · {a.product_clicks} product clicks · {a.enquiries} enquiries ·{' '}
                  {a.bookings} bookings · {a.accepted_bookings} accepted · {a.paid_bookings}{' '}
                  currently paid · {a.completed_bookings} completed · {a.cancelled_bookings}{' '}
                  cancelled/expired/declined · {money(a.completed_gross_kobo)} completed gross
                </Text>
              ))}
              {!row.analytics.length && <Text style={s.fine}>No views or product clicks yet.</Text>}
              {row.status === 'ACTIVE' && new Date(row.expires_at).getTime() > Date.now() && (
                <BoostStatusPanel statusId={row.id} />
              )}
              {['ACTIVE', 'EXPIRED'].includes(row.status) && (
                <Button
                  secondary
                  title="Delete this status"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('delete', '/local-status/{id}', { params: { id: row.id } });
                      await load();
                    }, 'Status deleted; the product listing is unchanged.')
                  }
                />
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}
