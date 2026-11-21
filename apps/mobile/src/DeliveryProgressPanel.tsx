import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Field, Chip, s } from './ui';
export default function DeliveryProgressPanel({
  delivery,
  isDriver = false,
}: {
  delivery: any;
  isDriver?: boolean;
}) {
  const { me: user, run, busy } = useApp();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [scheduled, setScheduled] = useState(''),
    [review, setReview] = useState({ punctuality: 5, care: 5, professionalism: 5, comment: '' }),
    [report, setReport] = useState(''),
    [reportOpen, setReportOpen] = useState(false);
  const load = () =>
    request('get', '/deliveries/{id}/timeline', { params: { id: delivery.id } }).then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [delivery.id, delivery.status]);
  const buyer = user?.id === delivery.buyer_id;
  const next: Record<
    string,
    'EN_ROUTE_PICKUP' | 'ARRIVED_PICKUP' | 'EN_ROUTE_DROPOFF' | 'ARRIVED_DROPOFF'
  > = {
    ASSIGNED: 'EN_ROUTE_PICKUP',
    EN_ROUTE_PICKUP: 'ARRIVED_PICKUP',
    GOODS_COLLECTED: 'EN_ROUTE_DROPOFF',
    PICKED_UP: 'EN_ROUTE_DROPOFF',
    EN_ROUTE_DROPOFF: 'ARRIVED_DROPOFF',
  };
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Delivery progress</Text>
      {error && <Text style={s.fine}>{error}</Text>}
      {data && (
        <>
          <Text style={s.body}>{data.stage.toLowerCase().replaceAll('_', ' ')}</Text>
          {data.scheduled_at && (
            <Text style={s.small}>Scheduled: {new Date(data.scheduled_at).toLocaleString()}</Text>
          )}
          {data.milestones.map((m: any) => (
            <Text key={m.stage} style={s.fine}>
              {m.stage.toLowerCase().replaceAll('_', ' ')} ·{' '}
              {new Date(m.created_at).toLocaleTimeString()}
            </Text>
          ))}
          {isDriver && next[data.stage] && ['ASSIGNED', 'PICKED_UP'].includes(delivery.status) && (
            <Button
              title={`Mark ${next[data.stage].toLowerCase().replaceAll('_', ' ')}`}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await request('post', '/deliveries/{id}/milestone', {
                    params: { id: delivery.id },
                    body: { stage: next[data.stage] },
                  });
                  await load();
                })
              }
            />
          )}{' '}
          {buyer && delivery.status === 'OPEN' && (
            <>
              <Field
                label="Schedule delivery (ISO date/time with timezone)"
                value={scheduled}
                onChangeText={setScheduled}
                placeholder="2026-12-01T10:00:00+01:00"
              />
              <Text style={s.fine}>
                Must be within the stock reservation. Riders can claim it 15 minutes before the
                scheduled time.
              </Text>
              <Button
                secondary
                title="Save delivery time"
                disabled={busy || !scheduled.trim()}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/deliveries/{id}/schedule', {
                      params: { id: delivery.id },
                      body: { scheduled_at: scheduled },
                    });
                    await load();
                  })
                }
              />
              <Button
                secondary
                title="Retry with nearby available riders now"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/deliveries/{id}/retry', {
                      params: { id: delivery.id },
                    });
                    await load();
                  }, 'Delivery reopened to nearby riders. No extra fee was charged.')
                }
              />
            </>
          )}
          {buyer &&
            delivery.pay_on_delivery &&
            delivery.status === 'PICKED_UP' &&
            data.stage === 'ARRIVED_DROPOFF' && (
              <>
                <Text style={s.small}>
                  Proposed inspection window: {data.inspection_minutes} minutes.{' '}
                  {data.inspection_deadline
                    ? `Review by ${new Date(data.inspection_deadline).toLocaleTimeString()}. `
                    : ''}{' '}
                  Inspect the goods, then accept before paying digitally. If there is a problem,
                  open the booking’s support case. No automatic debit happens when inspection time
                  ends.
                </Text>
                <Button
                  title={
                    data.inspection_started_at ? 'Accept inspected goods' : 'Start inspecting goods'
                  }
                  disabled={busy || !!data.inspection_accepted_at}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/deliveries/{id}/inspection', {
                        params: { id: delivery.id },
                        body: { action: data.inspection_started_at ? 'accept' : 'start' },
                      });
                      await load();
                    })
                  }
                />
              </>
            )}
          {buyer && delivery.status === 'DELIVERED' && !data.rating && (
            <>
              <Text style={s.bold}>Rate your rider</Text>
              {(['punctuality', 'care', 'professionalism'] as const).map((k) => (
                <View key={k}>
                  <Text style={s.label}>{k}</Text>
                  <View style={s.chipWrap}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Chip
                        key={n}
                        title={String(n)}
                        active={review[k] === n}
                        onPress={() => setReview({ ...review, [k]: n })}
                      />
                    ))}
                  </View>
                </View>
              ))}
              <Field
                label="Review comment (optional)"
                value={review.comment}
                onChangeText={(v: string) => setReview({ ...review, comment: v })}
              />
              <Button
                title="Submit completed-delivery review"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/deliveries/{id}/rating', {
                      params: { id: delivery.id },
                      body: review,
                    });
                    await load();
                  }, 'Thank you for reviewing your rider.')
                }
              />
            </>
          )}
        </>
      )}
      <Button
        secondary
        title={reportOpen ? 'Close incident report' : 'Report delivery or safety incident'}
        onPress={() => setReportOpen(!reportOpen)}
      />
      {reportOpen && (
        <>
          <Field label="Describe what happened" value={report} onChangeText={setReport} multiline />
          <Button
            title="Send to support"
            disabled={busy || report.trim().length < 10}
            onPress={() =>
              void run(async () => {
                await request('post', '/deliveries/{id}/incident', {
                  params: { id: delivery.id },
                  body: { kind: 'OTHER', description: report },
                });
                setReport('');
                setReportOpen(false);
              }, 'Incident recorded for support review.')
            }
          />
        </>
      )}
    </View>
  );
}
