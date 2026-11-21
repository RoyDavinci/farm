import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { money } from '@ahia/shared';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, s } from './ui';
export default function PreorderInterestPanel() {
  const { run, busy, openListing } = useApp();
  const [rows, setRows] = useState<any[]>([]),
    [open, setOpen] = useState(false);
  const load = () => request('get', '/preorder-interests').then(setRows);
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={
          open
            ? 'Close product interests'
            : `Product interest requests (${rows.filter((r) => ['WAITING', 'AVAILABLE'].includes(r.status)).length})`
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
              Save interest from a product page. We notify you when stock is available; you review
              the current price before booking.
            </Text>
          )}
          {rows.map((r) => (
            <View style={s.orderCard} key={r.id}>
              <Text style={s.bold}>
                {r.title} · {r.status.toLowerCase()}
              </Text>
              <Text style={s.small}>
                {r.quantity} requested · Current unit price {money(r.price_kobo)}. No money has been
                committed by saving interest.
              </Text>
              <Button
                secondary
                title="Review product & current options"
                onPress={() =>
                  void run(async () => {
                    openListing(
                      await request('get', '/listings/{id}', { params: { id: r.listing_id } }),
                    );
                  })
                }
              />
              {['WAITING', 'AVAILABLE'].includes(r.status) && (
                <>
                  <Button
                    title="Confirm booking at current price"
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/preorder-interests/{id}/confirm', {
                          params: { id: r.id },
                        });
                        await load();
                      }, 'Booking requested at the current price; the seller must confirm stock.')
                    }
                  />
                  <Button
                    secondary
                    title="Cancel interest"
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/preorder-interests/{id}/cancel', {
                          params: { id: r.id },
                        });
                        await load();
                      })
                    }
                  />
                </>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}
