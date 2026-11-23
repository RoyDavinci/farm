import StatusComposer from './StatusComposer';
import BoostStatusPanel from './BoostStatusPanel';
import { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { money } from '@ahia/shared';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, s } from './ui';
export default function LocalStatusPublisher() {
  const { busy, run, settings } = useApp();
  const [open, setOpen] = useState(false),
    [composing, setComposing] = useState(false),
    [rows, setRows] = useState<Awaited<ReturnType<typeof loadMine>>>([]);
  async function loadMine() {
    return request('get', '/local-status/mine');
  }
  const load = useCallback(() => loadMine().then(setRows), []);
  useEffect(() => {
    if (open) void load().catch(() => {});
  }, [open, load]);
  return (
    <View style={s.orderCard}>
      <Text style={s.cardTitle}>Your Local Status</Text>
      <Text style={s.fine}>
        Snap a photo or short video of a product and buyers nearby see it for{' '}
        {settings?.status_lifetime_hours || 24} hours. They can reply straight to your chat.
      </Text>
      <Button title="＋ Post a status" onPress={() => setComposing(true)} />
      <Button
        secondary
        title={open ? 'Hide your updates' : 'Your updates & analytics'}
        onPress={() => setOpen(!open)}
      />
      <StatusComposer
        visible={composing}
        onClose={() => setComposing(false)}
        onPosted={() => {
          setOpen(true);
          void load().catch(() => {});
        }}
      />
      {open && (
        <>
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
