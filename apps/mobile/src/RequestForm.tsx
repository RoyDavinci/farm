import { money } from '@ahia/shared';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { currentPosition } from './location';
import { request } from './request';
import { PointFields } from './RiderPicker';
import { Button, Chip, Field, s } from './ui';

const UNITS = ['crates', 'kg', 'bags', 'baskets', 'cartons', 'pieces', 'tubers', 'litres'];
const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/**
 * "Request what you need": what, how much, budget, by when, and where. Sellers within the chosen
 * distance of that spot who sell it (or something similar) are alerted and can quote.
 */
export default function RequestForm({
  initialText = '',
  onDone,
}: {
  initialText?: string;
  onDone?: () => void;
}) {
  const { busy, run } = useApp();
  const [text, setText] = useState(initialText),
    [qty, setQty] = useState(''),
    [unit, setUnit] = useState('crates'),
    [budget, setBudget] = useState(''),
    [neededBy, setNeededBy] = useState<string | null>(null),
    [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null),
    [area, setArea] = useState(''),
    [radius, setRadius] = useState(10),
    [sent, setSent] = useState<any>(null);
  if (sent)
    return (
      <View style={s.locationBox}>
        <Text style={s.bold}>✅ Request sent</Text>
        <Text style={s.small}>
          {sent.sellers.length
            ? `We alerted ${sent.sellers.length} seller${sent.sellers.length === 1 ? '' : 's'}${area ? ` near ${area}` : ''}. Quotes will show in Account → Price alerts & requests.`
            : 'No matching sellers nearby yet. Try a bigger distance; your request stays open for 7 days.'}
        </Text>
        {sent.sellers.slice(0, 5).map((x: any) => (
          <Text key={x.seller_id} style={s.small}>
            • {x.verified ? '✅ ' : ''}
            {x.business_name} · {x.reason}
          </Text>
        ))}
        <Pressable onPress={onDone}>
          <Text style={s.link}>Done</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>🙋 Request what you need</Text>
      <Text style={s.small}>Tell sellers near you what you want. They quote, you choose.</Text>
      <Field
        label="What do you need?"
        value={text}
        onChangeText={setText}
        placeholder="e.g. eggs, bell peppers, iPhone 13"
      />
      <Field
        label="How many?"
        value={qty}
        keyboardType="decimal-pad"
        onChangeText={(v: string) => setQty(v.replace(/[^0-9.]/g, ''))}
        placeholder="e.g. 20"
      />
      <View style={s.chipWrap}>
        {UNITS.map((u) => (
          <Chip key={u} title={u} active={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>
      <Field
        label="Budget (₦, optional)"
        value={budget}
        keyboardType="number-pad"
        onChangeText={(v: string) => setBudget(v.replace(/[^0-9]/g, ''))}
      />
      <Text style={s.small}>Needed by</Text>
      <View style={s.chipWrap}>
        {[
          ['Any time', null],
          ['Today', day(0)],
          ['Tomorrow', day(1)],
          ['This week', day(6)],
        ].map(([label, value]) => (
          <Chip
            key={String(label)}
            title={String(label)}
            active={neededBy === value}
            onPress={() => setNeededBy(value)}
          />
        ))}
      </View>
      <Text style={s.small}>Where? Sellers around this spot are alerted.</Text>
      <Button
        secondary
        title={point ? '📍 Location set · use my location again' : '📍 Use my location'}
        disabled={busy}
        onPress={() => void run(async () => setPoint(await currentPosition()))}
      />
      <PointFields title="Or pick on the map" value={point} onChange={setPoint} />
      <Field
        label="Area name (shown to sellers)"
        value={area}
        onChangeText={setArea}
        placeholder="e.g. Ikeja, Mile 12 market"
      />
      <View style={s.chipWrap}>
        {[3, 5, 10, 20, 50].map((r) => (
          <Chip
            key={r}
            title={`Within ${r} km`}
            active={radius === r}
            onPress={() => setRadius(r)}
          />
        ))}
      </View>
      <Button
        title="Send to sellers"
        disabled={busy || text.trim().length < 2 || !point}
        onPress={() =>
          void run(async () =>
            setSent(
              await request('post', '/product-requests', {
                body: {
                  text: text.trim(),
                  ...(Number(qty) > 0 ? { quantity: Number(qty), unit } : {}),
                  ...(Number(budget) > 0 ? { budget_kobo: Math.round(Number(budget) * 100) } : {}),
                  ...(neededBy ? { needed_by: neededBy } : {}),
                  latitude: point!.latitude,
                  longitude: point!.longitude,
                  ...(area.trim() ? { area: area.trim() } : {}),
                  radius_km: radius,
                },
              }),
            ),
          )
        }
      />
      {!point && <Text style={s.fine}>Set a location so nearby sellers can be alerted.</Text>}
      {Number(budget) > 0 && Number(qty) > 0 && (
        <Text style={s.fine}>
          About {money(Math.round((Number(budget) * 100) / Number(qty)))} per{' '}
          {unit.replace(/s$/, '')}.
        </Text>
      )}
    </View>
  );
}
