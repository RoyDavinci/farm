import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Chip, Field, s } from './ui';

/** "Tell me when it's cheaper" for a listing, catalogue product or search. */
export function WatchPrice({
  target,
  label,
}: {
  target: { listing_id?: string; catalogue_product_id?: string; query?: string };
  label?: string;
}) {
  const { busy, run } = useApp();
  const [watch, setWatch] = useState<{ id: string; watched_price_kobo: number | null } | null>(
    null,
  );
  return watch ? (
    <View style={s.locationBox}>
      <Text style={s.small}>
        🔔 Watching{watch.watched_price_kobo ? ` from ${money(watch.watched_price_kobo)}` : ''}.
        We’ll tell you when a seller cuts the price or runs a sale.
      </Text>
      <Pressable
        onPress={() =>
          void run(async () => {
            await request('delete', '/price-watches/{id}', { params: { id: watch.id } });
            setWatch(null);
          })
        }
      >
        <Text style={s.link}>Stop watching</Text>
      </Pressable>
    </View>
  ) : (
    <Button
      secondary
      title={label ?? '🔔 Tell me when it’s cheaper'}
      disabled={busy}
      onPress={() =>
        void run(async () =>
          setWatch((await request('post', '/price-watches', { body: target })) as any),
        )
      }
    />
  );
}

/**
 * Under search results: watch this search's prices, and when little turns up, show sellers who
 * probably have it (verified, well rated and reliable first) and let the buyer ask them.
 */
export function WantIt({
  query,
  few,
  point,
}: {
  query: string;
  few: boolean;
  point?: { latitude: number; longitude: number } | null;
}) {
  const { busy, run, openSeller } = useApp();
  const [hint, setHint] = useState<any>(null),
    [asked, setAsked] = useState<any>(null);
  const q = query.trim();
  useEffect(() => {
    setAsked(null);
    if (!few || q.length < 2) return setHint(null);
    const t = setTimeout(
      () =>
        void request('get', '/product-requests/suggest', {
          query: {
            q,
            ...(point ? { lat: String(point.latitude), lng: String(point.longitude) } : {}),
          } as any,
        })
          .then(setHint)
          .catch(() => setHint(null)),
      400,
    );
    return () => clearTimeout(t);
  }, [q, few, point?.latitude, point?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.length < 2) return null;
  return (
    <View style={{ gap: 10 }}>
      <WatchPrice key={q} target={{ query: q }} label={`🔔 Watch prices for “${q}”`} />
      {few && (
        <View style={s.locationBox}>
          <Text style={s.bold}>Can’t find what you need?</Text>
          {asked ? (
            <Text style={s.small}>
              ✅ We asked {asked.sellers.length} seller{asked.sellers.length === 1 ? '' : 's'} for “
              {asked.text}”. Offers will show in Account → Price alerts & requests.
            </Text>
          ) : (
            <>
              <Text style={s.small}>
                {hint?.sellers?.length
                  ? 'These sellers sell similar things and may have it:'
                  : 'Ask sellers near you; anyone who has it can offer it.'}
              </Text>
              {hint?.sellers?.slice(0, 5).map((x: any) => (
                <Pressable key={x.seller_id} onPress={() => openSeller(x.seller_id)}>
                  <Text style={s.bold}>
                    {x.verified ? '✅ ' : ''}
                    {x.business_name}
                  </Text>
                  <Text style={s.small}>{x.reason}</Text>
                </Pressable>
              ))}
              <Button
                title={`Ask sellers for “${q}”`}
                disabled={busy}
                onPress={() =>
                  void run(async () =>
                    setAsked(
                      await request('post', '/product-requests', {
                        body: {
                          text: q,
                          ...(point
                            ? { latitude: point.latitude, longitude: point.longitude }
                            : {}),
                        },
                      }),
                    ),
                  )
                }
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}

/** Account: price watches and requests (with sellers' offers). */
export function DealsInbox({ onOpenListing }: { onOpenListing?: (id: string) => void }) {
  const { busy, run } = useApp();
  const [watches, setWatches] = useState<any[]>([]),
    [requests, setRequests] = useState<any[]>([]);
  const load = useCallback(async () => {
    setWatches((await request('get', '/price-watches').catch(() => [])) as any[]);
    setRequests((await request('get', '/product-requests/mine').catch(() => [])) as any[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!watches.length && !requests.length) return null;
  return (
    <View style={s.orderCard}>
      <Text style={s.sectionTitle}>Price alerts & requests</Text>
      {watches.map((w) => (
        <View key={w.id} style={s.walletEntry}>
          <View style={s.flex}>
            <Text style={s.bold}>🔔 {w.label}</Text>
            <Text style={s.small}>
              {w.lowest
                ? `Lowest now ${money(w.lowest.price_kobo)} at ${w.lowest.business_name}${w.lowest.on_sale ? ' · on sale' : ''}`
                : 'No seller has it right now'}
              {w.watched_price_kobo ? ` · watching from ${money(w.watched_price_kobo)}` : ''}
            </Text>
          </View>
          <Pressable
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await request('delete', '/price-watches/{id}', { params: { id: w.id } });
                await load();
              })
            }
          >
            <Text style={s.link}>Stop</Text>
          </Pressable>
        </View>
      ))}
      {requests.map((r) => (
        <View key={r.id} style={{ gap: 6, paddingTop: 6 }}>
          <Text style={s.bold}>
            🙋 “{r.text}” · {r.status === 'OPEN' ? `asked ${r.sellers_alerted} sellers` : 'closed'}
          </Text>
          {r.offers.map((o: any) => (
            <Pressable
              key={o.id}
              onPress={() => onOpenListing?.(o.listing_id)}
              style={s.walletEntry}
            >
              {o.image_url ? (
                <Image
                  source={{ uri: o.image_url }}
                  style={{ width: 40, height: 40, borderRadius: 8 }}
                />
              ) : null}
              <View style={s.flex}>
                <Text style={s.bold}>{o.title}</Text>
                <Text style={s.small}>
                  {o.business_name} · {money(o.price_kobo)} / {o.unit}
                  {o.note ? ` · “${o.note}”` : ''}
                </Text>
              </View>
            </Pressable>
          ))}
          {!r.offers.length && r.status === 'OPEN' && <Text style={s.small}>No offers yet.</Text>}
        </View>
      ))}
    </View>
  );
}

/** Sell tab: requests from buyers this seller was alerted about, and offering a listing. */
export function SellerRequests({ listings }: { listings: any[] }) {
  const { busy, run } = useApp();
  const [rows, setRows] = useState<any[]>([]),
    [open, setOpen] = useState<string | null>(null),
    [note, setNote] = useState('');
  const load = useCallback(
    () =>
      request('get', '/sellers/me/product-requests')
        .then((r) => setRows(r as any[]))
        .catch(() => setRows([])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows.length) return null;
  const live = listings.filter((l) => l.status === 'ACTIVE' && !l.archived_at);
  return (
    <View style={s.orderCard}>
      <Text style={s.sectionTitle}>🙋 Buyers are looking for</Text>
      <Text style={s.small}>
        You sell similar things, so we asked you first. Offer something you have.
      </Text>
      {rows.map((r) => (
        <View key={r.id} style={{ gap: 6, paddingTop: 6 }}>
          <Text style={s.bold}>“{r.text}”</Text>
          {r.offered_listing_id ? (
            <Text style={s.small}>
              ✅ You offered {live.find((l) => l.id === r.offered_listing_id)?.title ?? 'an item'}.
            </Text>
          ) : open === r.id ? (
            <>
              <Field
                label="Note (optional)"
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Fresh today, ₦3,500 for 2 kg"
              />
              <View style={s.chipWrap}>
                {live.slice(0, 30).map((l) => (
                  <Chip
                    key={l.id}
                    title={`${l.title} · ${money(l.price_kobo)}`}
                    active={false}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/product-requests/{id}/offer', {
                          params: { id: r.id },
                          body: { listing_id: l.id, ...(note ? { note } : {}) },
                        });
                        setOpen(null);
                        setNote('');
                        await load();
                      }, 'Offer sent to the buyer.')
                    }
                  />
                ))}
              </View>
              <Text style={s.fine}>
                Not listed yet? Add it from the catalogue first, then offer it.
              </Text>
            </>
          ) : (
            <Button secondary title="I have this" disabled={busy} onPress={() => setOpen(r.id)} />
          )}
        </View>
      ))}
    </View>
  );
}

/** "Put on sale" for one listing: sale price and how many days. */
export function SaleEditor({ listing, onDone }: { listing: any; onDone: () => void }) {
  const { busy, run } = useApp();
  const [price, setPrice] = useState(''),
    [days, setDays] = useState(3);
  const onSale = listing.sale_until && new Date(listing.sale_until) > new Date();
  if (onSale)
    return (
      <View style={{ gap: 6 }}>
        <Text style={s.small}>
          On sale until {new Date(listing.sale_until).toLocaleDateString()} (usually{' '}
          {money(listing.was_price_kobo)})
        </Text>
        <Chip
          title="End sale now"
          active={false}
          onPress={() =>
            void run(async () => {
              await request('post', '/listings/{id}/sale', {
                params: { id: listing.id },
                body: { end: true },
              });
              onDone();
            }, 'Sale ended.')
          }
        />
      </View>
    );
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={`Sale price (₦) · now ${money(listing.price_kobo)}`}
        value={price}
        keyboardType="number-pad"
        onChangeText={(v: string) => setPrice(v.replace(/[^0-9]/g, ''))}
      />
      <View style={s.chipWrap}>
        {[1, 3, 7, 14].map((d) => (
          <Chip
            key={d}
            title={`${d} day${d === 1 ? '' : 's'}`}
            active={days === d}
            onPress={() => setDays(d)}
          />
        ))}
      </View>
      <Button
        title="Start sale · watchers get told"
        disabled={busy || !(Number(price) > 0)}
        onPress={() =>
          void run(async () => {
            await request('post', '/listings/{id}/sale', {
              params: { id: listing.id },
              body: { price_kobo: Math.round(Number(price) * 100), days },
            });
            onDone();
          }, 'Sale started.')
        }
      />
    </View>
  );
}

/** "Was ₦X" next to a price while on sale. */
export function WasPrice({ listing }: { listing: any }) {
  if (!listing?.was_price_kobo || !listing.sale_until || new Date(listing.sale_until) <= new Date())
    return null;
  const off = Math.round((1 - listing.price_kobo / listing.was_price_kobo) * 100);
  return (
    <Text style={s.small}>
      🏷️ Sale −{off}% · was{' '}
      <Text style={{ textDecorationLine: 'line-through' }}>{money(listing.was_price_kobo)}</Text> ·
      until {new Date(listing.sale_until).toLocaleDateString()}
    </Text>
  );
}
