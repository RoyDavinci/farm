import { money, statusLabel, type Listing } from '@ahia/shared';
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
