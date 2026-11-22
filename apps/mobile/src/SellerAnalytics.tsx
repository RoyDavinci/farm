import { money } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { request } from './request';
import { Chip, s } from './ui';

interface Analytics {
  days: number;
  orders: number;
  gross_kobo: number;
  net_kobo: number;
  average_order_kobo: number;
  buyers: number;
  repeat_buyers: number;
  acceptance_rate: number | null;
  daily: { day: string; gross_kobo: number; orders: number }[];
  top_listings: {
    listing_id: string;
    title: string;
    orders: number;
    quantity: number;
    gross_kobo: number;
  }[];
  rating: { avg: number | null; count: number };
  followers: number;
  low_stock: { id: string; title: string; variant: string; stock: number; unit: string }[];
}

/** Sales dashboard for approved sellers. Figures count confirmed pickups only. */
export default function SellerAnalytics({ refreshVersion }: { refreshVersion: number }) {
  const [days, setDays] = useState(30),
    [data, setData] = useState<Analytics | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    (request('get', '/sellers/me/analytics', { query: { days } }) as Promise<Analytics>)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [days, refreshVersion]);
  if (error) return <Text style={s.fine}>{error}</Text>;
  if (!data) return null;
  const peak = Math.max(1, ...data.daily.map((d) => d.gross_kobo));
  // Group long ranges into weeks so the bars stay readable on a phone.
  const bucket = data.daily.length > 45 ? 7 : 1;
  const bars: { label: string; gross: number }[] = [];
  for (let i = 0; i < data.daily.length; i += bucket) {
    const slice = data.daily.slice(i, i + bucket);
    bars.push({ label: slice[0].day.slice(5), gross: slice.reduce((n, d) => n + d.gross_kobo, 0) });
  }
  const barPeak = Math.max(1, ...bars.map((b) => b.gross)) || peak;
  return (
    <View style={s.orderCard}>
      <View style={s.rowBetween}>
        <Text style={s.sectionTitle}>Your sales</Text>
        <View style={s.inlineActions}>
          {[7, 30, 90].map((d) => (
            <Chip key={d} title={`${d} days`} active={days === d} onPress={() => setDays(d)} />
          ))}
        </View>
      </View>
      <View style={a.tiles}>
        <Tile label="Sales" value={money(data.gross_kobo)} detail={`${data.orders} pickups`} />
        <Tile label="Your earnings" value={money(data.net_kobo)} detail="after commission" />
        <Tile
          label="Average order"
          value={money(data.average_order_kobo)}
          detail={`${data.buyers} buyers`}
        />
        <Tile
          label="Repeat buyers"
          value={String(data.repeat_buyers)}
          detail={`${data.followers} following you`}
        />
      </View>
      <Text style={s.label}>Daily sales</Text>
      <View style={a.chart} accessibilityLabel={`Sales over the last ${data.days} days`}>
        {bars.map((b) => (
          <View key={b.label} style={a.barSlot}>
            <View
              style={[
                a.bar,
                { height: `${Math.max(2, (b.gross / barPeak) * 100)}%` },
                !b.gross && a.empty,
              ]}
            />
          </View>
        ))}
      </View>
      <View style={s.rowBetween}>
        <Text style={s.small}>{bars[0]?.label}</Text>
        <Text style={s.small}>{data.gross_kobo ? `Peak ${money(barPeak)}` : 'No sales yet'}</Text>
        <Text style={s.small}>{bars.at(-1)?.label}</Text>
      </View>
      <Text style={s.small}>
        {data.acceptance_rate === null
          ? 'No booking requests answered in this period.'
          : `You accepted ${Math.round(data.acceptance_rate * 100)}% of booking requests.`}{' '}
        {data.rating.count ? `Rating ★ ${data.rating.avg} from ${data.rating.count} reviews.` : ''}
      </Text>
      {!!data.top_listings.length && <Text style={s.label}>Best sellers</Text>}
      {data.top_listings.map((t) => (
        <View key={t.listing_id} style={s.rowBetween}>
          <Text style={s.body}>
            {t.title} · {t.orders} orders
          </Text>
          <Text style={s.bold}>{money(t.gross_kobo)}</Text>
        </View>
      ))}
      {!!data.low_stock.length && <Text style={s.label}>Running low</Text>}
      {data.low_stock.map((l) => (
        <Text key={`${l.id}-${l.variant}`} style={s.small}>
          {l.title} ({l.variant}): {l.stock} {l.unit} left
        </Text>
      ))}
    </View>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View style={a.tile}>
      <Text style={s.small}>{label}</Text>
      <Text style={a.value}>{value}</Text>
      <Text style={s.small}>{detail}</Text>
    </View>
  );
}

const a = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#eff9f4',
    gap: 2,
  },
  value: { fontSize: 18, fontWeight: '600', color: '#245b40' },
  chart: { height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: '#2c8358', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  empty: { backgroundColor: '#d5ece0' },
});
