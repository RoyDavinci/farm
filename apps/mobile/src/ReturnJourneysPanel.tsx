import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { money } from '@zuru/shared';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Field, s } from './ui';
export default function ReturnJourneysPanel() {
  const { me, run, busy } = useApp();
  const [rows, setRows] = useState<any[]>([]),
    [pins, setPins] = useState<Record<string, string>>({}),
    [open, setOpen] = useState(false);
  const load = () => request('get', '/return-journeys').then(setRows);
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={
          open
            ? 'Close return journeys'
            : `Return journeys (${rows.filter((r) => !['RETURNED', 'CANCELLED'].includes(r.status)).length})`
        }
        onPress={() => {
          setOpen(!open);
          void load();
        }}
      />
      {open && (
        <>
          {!rows.length && (
            <Text style={s.small}>
              Support arranges reviewed return transport from the booking’s dispute case.
            </Text>
          )}
          {rows.map((r) => (
            <View key={r.id} style={s.orderCard}>
              <Text style={s.bold}>
                {r.status.toLowerCase().replaceAll('_', ' ')} · Return {r.id.slice(0, 8)}
              </Text>
              <Text style={s.small}>From: {r.pickup_address}</Text>
              <Text style={s.small}>To: {r.dropoff_address}</Text>
              <Text style={s.small}>
                Reviewed fee {money(r.fee_kobo)} · Rider compensation {money(r.driver_kobo)}
              </Text>
              <Text style={s.fine}>{r.reason}</Text>
              {r.pickup_pin && (
                <Text style={s.bold}>Give the collecting rider this PIN: {r.pickup_pin}</Text>
              )}
              {r.return_pin && (
                <Text style={s.bold}>
                  Give the rider this PIN when goods return: {r.return_pin}
                </Text>
              )}
              {me.id === r.driver_id && r.status === 'ASSIGNED' && (
                <Button
                  title="Accept return transport"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/return-journeys/{id}/action', {
                        params: { id: r.id },
                        body: { action: 'accept' },
                      });
                      await load();
                    })
                  }
                />
              )}{' '}
              {me.id === r.driver_id && ['ACCEPTED', 'PICKED_UP'].includes(r.status) && (
                <>
                  <Field
                    label={r.status === 'ACCEPTED' ? 'Buyer collection PIN' : 'Seller return PIN'}
                    value={pins[r.id] || ''}
                    onChangeText={(v: string) => setPins({ ...pins, [r.id]: v })}
                    keyboardType="number-pad"
                  />
                  <Button
                    title={
                      r.status === 'ACCEPTED'
                        ? 'Confirm return collection'
                        : 'Confirm goods returned'
                    }
                    disabled={busy || !/^\d{6}$/.test(pins[r.id] || '')}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/return-journeys/{id}/action', {
                          params: { id: r.id },
                          body: {
                            action: r.status === 'ACCEPTED' ? 'pickup' : 'complete',
                            pin: pins[r.id],
                          },
                        });
                        await load();
                      }, 'Return progress recorded.')
                    }
                  />
                </>
              )}
              {r.status === 'ASSIGNED' && [r.driver_id, r.buyer_id].includes(me.id) && (
                <Button
                  secondary
                  title="Cancel invitation & return held fee"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await request('post', '/return-journeys/{id}/action', {
                        params: { id: r.id },
                        body: { action: 'cancel' },
                      });
                      await load();
                    })
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
