import { money, statusLabel, type Listing } from '@ahia/shared';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { uploadSellerDocument } from './api';
import { useApp } from './AppContext';
import { request } from './request';
import { Badge, Button, Chip, s } from './ui';

const documentKinds = [
  ['government_id', 'NIN card or slip (or passport, licence)'],
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

/**
 * Private verification documents for the operations team. A document that is under review or
 * approved can't be uploaded again (unless it is rejected); "Add another document" is always there.
 */
export function VerificationDocuments({
  subject = 'seller',
  version = 0,
  onChange,
}: {
  subject?: 'seller' | 'driver';
  /** Bump to reload, e.g. after another panel uploads a document. */
  version?: number;
  onChange?: () => void;
}) {
  const { busy, run } = useApp();
  const kinds = subject === 'driver' ? driverKinds : documentKinds;
  const [docs, setDocs] = useState<any[]>([]),
    [kind, setKind] = useState<string>('');
  const load = useCallback(
    () =>
      request('get', '/sellers/me/documents', { query: { subject } })
        .then(setDocs)
        .catch(() => {}),
    [subject],
  );
  useEffect(() => void load(), [load, version]);
  const names: Record<string, string> = {
    ...Object.fromEntries(kinds),
    selfie: 'Selfie',
    other: 'Other document',
  };
  const held = new Set(docs.filter((d) => d.status !== 'REJECTED').map((d) => d.kind));
  const missing = kinds.filter(([value]) => value !== 'other' && !held.has(value));
  const chosen = missing.find(([value]) => value === kind) ?? missing[0];
  const upload = (as: string) =>
    void run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      await uploadSellerDocument(as, picked.assets[0] as any, subject);
      await load();
      onChange?.();
    }, 'Document uploaded for review.');
  return (
    <View style={s.orderCard}>
      <Text style={s.sectionTitle}>Verification documents</Text>
      <Text style={s.fine}>
        Documents are stored privately and only our verification team can open them. Photos or PDFs
        up to 8 MB.
      </Text>
      {docs.map((d) => (
        <View key={d.id} style={s.walletEntry}>
          <View style={s.flex}>
            <Text style={s.bold}>{names[d.kind] || statusLabel(d.kind)}</Text>
            <Text style={s.small}>
              {new Date(d.created_at).toLocaleDateString()} ·{' '}
              {d.status === 'ACCEPTED'
                ? 'Approved'
                : d.status === 'PENDING'
                  ? 'Being reviewed'
                  : 'Rejected — please upload it again'}
            </Text>
            {d.review_note && <Text style={s.fine}>{d.review_note}</Text>}
          </View>
          <Badge status={d.status === 'ACCEPTED' ? 'APPROVED' : d.status} />
        </View>
      ))}
      {!!missing.length && chosen && (
        <>
          <Text style={s.bold}>{docs.length ? 'Still to upload' : 'Upload a document'}</Text>
          <View style={s.chipWrap}>
            {missing.map(([value, label]) => (
              <Chip
                key={value}
                title={label}
                active={chosen[0] === value}
                onPress={() => setKind(value)}
              />
            ))}
          </View>
          <Button
            secondary
            title={`Upload ${chosen[1].replace(/ \(.*\)$/, '')}`}
            disabled={busy}
            onPress={() => upload(chosen[0])}
          />
        </>
      )}
      <Button
        secondary
        title="＋ Add another document"
        disabled={busy}
        onPress={() => upload('other')}
      />
    </View>
  );
}
