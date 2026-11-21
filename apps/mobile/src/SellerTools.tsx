import { money, statusLabel, type Listing } from '@zuru/shared';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { uploadSellerDocument } from './api';
import { useApp } from './AppContext';
import { request } from './request';
import { Badge, Button, Chip, s } from './ui';

const documentKinds = [
  ['government_id', 'Government ID (NIN, passport, licence)'],
  ['business_registration', 'Business registration (CAC)'],
  ['proof_of_address', 'Proof of address'],
  ['other', 'Other supporting document'],
] as const;
const driverKinds = [
  ['profile_photo', 'Driver profile photo'],
  ['vehicle_photo', 'Vehicle photo'],
  ['operating_permit', 'Operating permit'],
  ['insurance', 'Insurance evidence'],
  ['drivers_licence', 'Driver’s licence'],
  ['vehicle_registration', 'Vehicle registration / papers'],
  ['government_id', 'Government ID (NIN, passport)'],
  ['other', 'Other supporting document'],
] as const;

/** Seller uploads private verification documents for the operations team to review. */
export function VerificationDocuments({ subject = 'seller' }: { subject?: 'seller' | 'driver' }) {
  const { busy, run } = useApp();
  const kinds = subject === 'driver' ? driverKinds : documentKinds;
  const [docs, setDocs] = useState<any[]>([]),
    [kind, setKind] = useState<string>(kinds[0][0]);
  const load = useCallback(
    () =>
      request('get', '/sellers/me/documents', { query: { subject } })
        .then(setDocs)
        .catch(() => {}),
    [subject],
  );
  useEffect(() => void load(), [load]);
  return (
    <View style={s.orderCard}>
      <Text style={s.sectionTitle}>Verification documents</Text>
      <Text style={s.fine}>
        Documents are stored privately and only our verification team can open them. Photos or PDFs
        up to 8 MB.
      </Text>
      <View style={s.chipWrap}>
        {kinds.map(([value, label]) => (
          <Chip key={value} title={label} active={kind === value} onPress={() => setKind(value)} />
        ))}
      </View>
      <Button
        secondary
        title="Upload document"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            const picked = await DocumentPicker.getDocumentAsync({
              type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
              copyToCacheDirectory: true,
            });
            if (picked.canceled) return;
            await uploadSellerDocument(kind, picked.assets[0] as any, subject);
            await load();
          }, 'Document uploaded for review.')
        }
      />
      {docs.map((d) => (
        <View key={d.id} style={s.walletEntry}>
          <View style={s.flex}>
            <Text style={s.bold}>{statusLabel(d.kind)}</Text>
            <Text style={s.small}>{new Date(d.created_at).toLocaleDateString()}</Text>
            {d.review_note && <Text style={s.fine}>{d.review_note}</Text>}
          </View>
          <Badge status={d.status === 'ACCEPTED' ? 'APPROVED' : d.status} />
        </View>
      ))}
    </View>
  );
}

/** Lets a seller sponsor a listing, paid from seller proceeds. */
export function PromoteListing({ listing }: { listing: Listing }) {
  const { busy, run, settings } = useApp();
  const [open, setOpen] = useState(false),
    [days, setDays] = useState(7);
  const daily = settings?.promotion_daily_kobo ?? 50000;
  if (listing.status !== 'ACTIVE') return null;
  if (!open)
    return (
      <Pressable onPress={() => setOpen(true)}>
        <Text style={s.link}>Sponsor this listing →</Text>
      </Pressable>
    );
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Sponsor in search results</Text>
      <Text style={s.small}>
        Sponsored listings appear at the top of matching searches with a “Sponsored” label. Paid
        from your seller proceeds at {money(daily)} per day.
      </Text>
      <View style={s.chipWrap}>
        {[3, 7, 14, 30].map((d) => (
          <Chip key={d} title={`${d} days`} active={days === d} onPress={() => setDays(d)} />
        ))}
      </View>
      <Button
        title={`Sponsor for ${money(days * daily)}`}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await request('post', '/listings/{id}/promote', {
              params: { id: listing.id },
              body: { days },
            });
            setOpen(false);
          }, 'Your listing is now sponsored.')
        }
      />
      <Pressable onPress={() => setOpen(false)}>
        <Text style={s.link}>Not now</Text>
      </Pressable>
    </View>
  );
}
