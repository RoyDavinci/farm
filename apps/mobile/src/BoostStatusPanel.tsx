import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { money } from '@ahia/shared';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Chip, Field, s } from './ui';
type Target = { state: string; kind: 'LGA' | 'CITY'; name: string };
export default function BoostStatusPanel({ statusId }: { statusId: string }) {
  const { seller, busy, run } = useApp();
  const [open, setOpen] = useState(false),
    [state, setState] = useState(seller?.state || ''),
    [name, setName] = useState(''),
    [kind, setKind] = useState<'LGA' | 'CITY'>('LGA'),
    [hours, setHours] = useState(3),
    [targets, setTargets] = useState<Target[]>([]),
    [quote, setQuote] = useState<{
      fee_kobo: number;
      hourly_kobo: number;
      hours: number;
      targets: Target[];
    } | null>(null),
    [campaigns, setCampaigns] = useState<Awaited<ReturnType<typeof fetchCampaigns>>>([]),
    [error, setError] = useState('');
  async function fetchCampaigns() {
    return request('get', '/status-boosts/mine');
  }
  const load = async () =>
    setCampaigns((await fetchCampaigns()).filter((c) => c.status_id === statusId));
  useEffect(() => {
    if (open) void load().catch((e) => setError(e.message));
  }, [open, statusId]);
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={open ? 'Close Boost Status' : 'Boost this status'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={s.bold}>Reach shoppers browsing selected areas</Text>
          <Text style={s.fine}>
            Campaigns are reviewed before starting. The budget is held from seller earnings;
            rejection or cancellation before approval returns it in full. Active campaigns return
            the unused time portion when stopped. There is no guaranteed number of views or sales.
          </Text>
          {!!error && <Text style={s.fine}>{error}</Text>}
          <Field label="Target state" value={state} onChangeText={setState} />
          <View style={s.chipWrap}>
            <Chip title="LGA" active={kind === 'LGA'} onPress={() => setKind('LGA')} />
            <Chip title="City" active={kind === 'CITY'} onPress={() => setKind('CITY')} />
          </View>
          <Field
            label={kind === 'LGA' ? 'Target LGA' : 'Target city'}
            value={name}
            onChangeText={setName}
          />
          <Button
            secondary
            title="Add target area"
            disabled={!state.trim() || !name.trim() || targets.length >= 5}
            onPress={() => {
              const target = { state: state.trim(), kind, name: name.trim() };
              if (
                !targets.some(
                  (t) => JSON.stringify(t).toLowerCase() === JSON.stringify(target).toLowerCase(),
                )
              )
                setTargets([...targets, target]);
              setQuote(null);
              setName('');
            }}
          />
          {targets.map((t, i) => (
            <View key={i} style={s.rowBetween}>
              <Text style={s.small}>
                {t.kind}: {t.name}, {t.state}
              </Text>
              <Button
                secondary
                title="Remove area"
                onPress={() => {
                  setTargets(targets.filter((_, j) => j !== i));
                  setQuote(null);
                }}
              />
            </View>
          ))}
          <Text style={s.small}>Duration after approval (must fit before this status expires)</Text>
          <View style={s.chipWrap}>
            {[1, 3, 6, 12, 24].map((h) => (
              <Chip
                key={h}
                title={`${h}h`}
                active={hours === h}
                onPress={() => {
                  setHours(h);
                  setQuote(null);
                }}
              />
            ))}
          </View>
          <Button
            secondary
            title="Review campaign price"
            disabled={busy || !targets.length}
            onPress={() =>
              void run(async () => {
                setQuote(
                  await request('post', '/local-status/{id}/boost-quote', {
                    params: { id: statusId },
                    body: { hours, targets },
                  }),
                );
              })
            }
          />
          {quote && (
            <>
              <Text style={s.bold}>Budget: {money(quote.fee_kobo)}</Text>
              <Text style={s.fine}>
                {quote.hours} hours × {quote.targets.length} target areas at{' '}
                {money(quote.hourly_kobo)} per hour per area. Content stays subject to listing
                availability and expiry. No broadcast push notifications.
              </Text>
              <Button
                title={`Hold ${money(quote.fee_kobo)} & submit for review`}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/local-status/{id}/boost', {
                      params: { id: statusId },
                      body: {
                        hours: quote.hours,
                        targets: quote.targets,
                        expected_fee_kobo: quote.fee_kobo,
                      },
                    });
                    setQuote(null);
                    await load();
                  }, 'Campaign submitted for review; the budget is held from your earnings.')
                }
              />
            </>
          )}
          {campaigns.map((c) => (
            <View key={c.id} style={s.orderCard}>
              <Text style={s.bold}>
                {c.status} · {money(c.fee_kobo)}
              </Text>
              <Text style={s.small}>
                {c.hours} hours · {c.targets.map((t) => `${t.name}, ${t.state}`).join(' · ')}
              </Text>
              <Text style={s.fine}>
                {c.starts_at
                  ? `Started ${new Date(c.starts_at).toLocaleString()}`
                  : 'Waiting for review'}
                {c.ends_at ? ` · Ends ${new Date(c.ends_at).toLocaleString()}` : ''}
              </Text>
              <Text style={s.small}>
                {c.views} views · {c.product_clicks} product clicks · {c.bookings} bookings ·{' '}
                {c.completed_bookings} completed
              </Text>
              <Text style={s.fine}>
                {c.reason || ''}
                {c.refund_kobo ? ` · Returned ${money(c.refund_kobo)}` : ''}
              </Text>
              {['PENDING', 'ACTIVE'].includes(c.status) && (
                <Button
                  secondary
                  title="Stop campaign & return unused budget"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/status-boosts/{id}/cancel', { params: { id: c.id } });
                      await load();
                    }, 'Campaign stopped. Any unused campaign budget was returned to your earnings.')
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
