import { money, type Listing } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { uploadSellerDocument } from './api';
import { currentPosition } from './location';
import { useApp } from './AppContext';
import { snap } from './camera';
import BvnVerify from './BvnVerify';
import { request } from './request';
import { Button, Chip, Field, s } from './ui';

const statusCopy: Record<string, [string, string]> = {
  NONE: ['Not verified', 'Get the Verified badge so buyers know your business was checked.'],
  PENDING: ['Under review', 'Our team is checking your details and documents.'],
  INFO_REQUESTED: [
    'More information needed',
    'Update your details or documents, then apply again.',
  ],
  VERIFIED: ['Verified', 'Buyers see the Verified badge on your shop and products.'],
  REJECTED: ['Not verified', 'Your last application was not approved. You can apply again.'],
  SUSPENDED: ['Badge suspended', 'Contact support to review your verification.'],
  EXPIRED: ['Verification expired', 'Apply again to renew your Verified badge.'],
};

/** "✓ Verified" chip for shops and products. Verification is checked by Ahia, never bought. */
export function VerifiedBadge({ small = false }: { small?: boolean }) {
  return (
    <View style={[styles.badge, small && styles.badgeSmall]} accessibilityLabel="Verified business">
      <Text style={[styles.badgeText, small && { fontSize: 10 }]}>✓ Verified</Text>
    </View>
  );
}

function Check({ done, label }: { done: boolean; label: string }) {
  return (
    <Text style={[s.small, done && styles.good]}>
      {done ? '✓' : '○'} {label}
    </Text>
  );
}

/**
 * Seller: apply for business verification and see its history. Asks for the owner's full name,
 * home address, current location, a selfie, and a NIN card photo or BVN.
 */
export function VerificationPanel({
  version = 0,
  onDocuments,
}: {
  version?: number;
  onDocuments?: () => void;
}) {
  const { run, busy } = useApp();
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    home_address: '',
    id_method: 'NIN' as 'NIN' | 'BVN',
    nin: '',
    bvn: '',
    legal_name: '',
    registration_number: '',
  });
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const load = () =>
    request('get', '/sellers/me/verification')
      .then((d) => {
        setData(d);
        const det: any = d.details || {};
        // Identity numbers come back masked, so they're never prefilled.
        setForm((f) => ({
          ...f,
          ...Object.fromEntries(
            Object.entries(det).filter(([k]) => k in f && k !== 'nin' && k !== 'bvn'),
          ),
        }));
      })
      .catch(() => {});
  useEffect(() => void load(), [version]);
  if (!data) return null;
  const [title, text] = statusCopy[data.status];
  const canApply = ['NONE', 'REJECTED', 'INFO_REQUESTED', 'EXPIRED'].includes(data.status);
  const upload = (kind: 'selfie' | 'government_id', front: boolean, fromFiles = false) =>
    void run(
      async () => {
        let asset: any = null;
        if (fromFiles) {
          const picked = await DocumentPicker.getDocumentAsync({
            type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
            copyToCacheDirectory: true,
          });
          asset = picked.canceled ? null : picked.assets[0];
        } else asset = await snap(front);
        if (!asset) return;
        await uploadSellerDocument(kind, asset);
        await load();
        onDocuments?.();
      },
      kind === 'selfie' ? 'Selfie saved.' : 'NIN card saved.',
    );
  const idReady =
    form.id_method === 'BVN'
      ? /^\d{11}$/.test(form.bvn)
      : data.has_id_card && (!form.nin || /^\d{11}$/.test(form.nin));
  const ready =
    form.full_name.trim().length >= 3 &&
    form.home_address.trim().length >= 8 &&
    !!point &&
    data.has_selfie &&
    idReady;
  return (
    <View style={s.locationBox}>
      <View style={styles.row}>
        <Text style={s.bold}>Business verification</Text>
        {data.status === 'VERIFIED' ? (
          <VerifiedBadge />
        ) : (
          <Text style={styles.status}>{title}</Text>
        )}
      </View>
      <Text style={s.small}>{text}</Text>
      {data.expires_at && data.status === 'VERIFIED' && (
        <Text style={s.small}>Review due {new Date(data.expires_at).toLocaleDateString()}.</Text>
      )}
      {data.history[0]?.note && data.status !== 'PENDING' && (
        <Text style={s.small}>Latest note: {data.history[0].note}</Text>
      )}
      {canApply && !open && (
        <Button secondary title="Apply for the Verified badge" onPress={() => setOpen(true)} />
      )}
      {open && (
        <View style={{ gap: 10 }}>
          <Text style={s.small}>You’ll need:</Text>
          {data.requirements.map((r: string) => (
            <Text key={r} style={s.small}>
              • {r}
            </Text>
          ))}

          <Text style={styles.step}>1. About you</Text>
          <Field
            label="Full name (as on your ID)"
            value={form.full_name}
            autoComplete="name"
            onChangeText={(v: string) => setForm({ ...form, full_name: v })}
          />
          <Field
            label="Home address (kept private)"
            value={form.home_address}
            onChangeText={(v: string) => setForm({ ...form, home_address: v })}
          />

          <Text style={styles.step}>2. Your location</Text>
          {point ? (
            <Text style={[s.small, styles.good]}>
              ✓ Location captured ({point.latitude.toFixed(4)}, {point.longitude.toFixed(4)})
            </Text>
          ) : (
            <Button
              secondary
              title="📍 Share my current location"
              disabled={busy}
              onPress={() => void run(async () => setPoint(await currentPosition()))}
            />
          )}

          <Text style={styles.step}>3. A selfie</Text>
          {data.has_selfie ? (
            <Check done label="Selfie received" />
          ) : (
            <Button
              secondary
              title="🤳 Take a selfie"
              disabled={busy}
              onPress={() => upload('selfie', true)}
            />
          )}

          <Text style={styles.step}>4. Your ID</Text>
          <View style={s.chipWrap}>
            <Chip
              title="NIN card or slip"
              active={form.id_method === 'NIN'}
              onPress={() => setForm({ ...form, id_method: 'NIN' })}
            />
            <Chip
              title="BVN"
              active={form.id_method === 'BVN'}
              onPress={() => setForm({ ...form, id_method: 'BVN' })}
            />
          </View>
          {form.id_method === 'NIN' ? (
            <>
              {data.has_id_card ? (
                <Check done label="NIN card received" />
              ) : (
                <View style={s.inlineActions}>
                  <Button
                    secondary
                    title="📷 Photograph card"
                    disabled={busy}
                    onPress={() => upload('government_id', false)}
                  />
                  <Button
                    secondary
                    title="Choose file"
                    disabled={busy}
                    onPress={() => upload('government_id', false, true)}
                  />
                </View>
              )}
              <Field
                label="NIN (optional, 11 digits)"
                value={form.nin}
                keyboardType="number-pad"
                maxLength={11}
                onChangeText={(v: string) => setForm({ ...form, nin: v.replace(/\D/g, '') })}
              />
            </>
          ) : (
            <Field
              label="BVN (11 digits)"
              value={form.bvn}
              keyboardType="number-pad"
              maxLength={11}
              onChangeText={(v: string) => setForm({ ...form, bvn: v.replace(/\D/g, '') })}
            />
          )}
          <Text style={s.fine}>
            Only our verification team sees your ID number. We never ask for your BVN PIN or bank
            password.
          </Text>
          {/* Instant check with Flutterwave: a confirmed BVN also raises withdrawal limits. */}
          <BvnVerify />

          <Text style={styles.step}>5. Your business (optional)</Text>
          <Field
            label="Registered business name"
            value={form.legal_name}
            onChangeText={(v: string) => setForm({ ...form, legal_name: v })}
          />
          <Field
            label="CAC number (if registered)"
            value={form.registration_number}
            onChangeText={(v: string) => setForm({ ...form, registration_number: v })}
          />

          <Check done={form.full_name.trim().length >= 3} label="Full name" />
          <Check done={form.home_address.trim().length >= 8} label="Home address" />
          <Check done={!!point} label="Location" />
          <Check done={data.has_selfie} label="Selfie" />
          <Check done={!!idReady} label={form.id_method === 'BVN' ? 'BVN' : 'NIN card'} />
          <Button
            title={busy ? 'Sending…' : 'Send for review'}
            disabled={busy || !ready}
            onPress={() =>
              void run(async () => {
                await request('post', '/sellers/me/verification', {
                  body: {
                    full_name: form.full_name,
                    home_address: form.home_address,
                    latitude: point!.latitude,
                    longitude: point!.longitude,
                    id_method: form.id_method,
                    ...(form.id_method === 'NIN'
                      ? form.nin
                        ? { nin: form.nin }
                        : {}
                      : { bvn: form.bvn }),
                    legal_name: form.legal_name,
                    registration_number: form.registration_number,
                  },
                });
                setOpen(false);
                await load();
              }, 'Application sent. We’ll review it and let you know.')
            }
          />
        </View>
      )}
      <Text style={s.fine}>{data.means}</Text>
    </View>
  );
}

/** Seller: feature the whole shop on Home for a fixed period, paid from sales proceeds. */
export function FeatureShop() {
  const { run, busy } = useApp();
  const [packages, setPackages] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const load = () => {
    void request('get', '/promotion-packages', { query: { kind: 'SELLER' } })
      .then((p) => {
        setPackages(p);
        setChoice((c) => c ?? p[0]?.id ?? null);
      })
      .catch(() => {});
    void request('get', '/sellers/me/featured')
      .then(setMine)
      .catch(() => {});
  };
  useEffect(load, []);
  const running = mine.find((f) => f.running);
  if (!packages.length) return null;
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Feature your shop</Text>
      <Text style={s.small}>
        Featured shops appear on buyers’ Home screens near you, labelled “Featured”. Paid from your
        sales proceeds. Featuring doesn’t make a shop Verified.
      </Text>
      {running ? (
        <Text style={styles.good}>
          Your shop is featured until {new Date(running.ends_at).toLocaleDateString()}.
        </Text>
      ) : (
        <>
          <View style={s.chipWrap}>
            {packages.map((p) => (
              <Chip
                key={p.id}
                title={`${p.days} days · ${money(p.price_kobo)}`}
                active={choice === p.id}
                onPress={() => setChoice(p.id)}
              />
            ))}
          </View>
          <Button
            title="Feature my shop"
            disabled={busy || !choice}
            onPress={() =>
              void run(async () => {
                await request('post', '/sellers/me/featured', { body: { package_id: choice! } });
                load();
              }, 'Your shop is now featured.')
            }
          />
        </>
      )}
    </View>
  );
}

/** Seller: sponsor one listing with a fixed-length package, paid from proceeds. */
export function PromoteWithPackage({ listing }: { listing: Listing }) {
  const { busy, run } = useApp();
  const [open, setOpen] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void request('get', '/promotion-packages', { query: { kind: 'PRODUCT' } }).then((p) => {
      setPackages(p);
      setChoice(p[0]?.id ?? null);
    });
  }, [open]);
  if (listing.status !== 'ACTIVE') return null;
  if (!open)
    return (
      <Pressable onPress={() => setOpen(true)}>
        <Text style={s.link}>Sponsor this listing →</Text>
      </Pressable>
    );
  const picked = packages.find((p) => p.id === choice);
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Sponsor in search results</Text>
      <Text style={s.small}>
        Sponsored listings show in matching searches with a “Sponsored” label. Paid from your sales
        proceeds.
      </Text>
      <View style={s.chipWrap}>
        {packages.map((p) => (
          <Chip
            key={p.id}
            title={`${p.days} days · ${money(p.price_kobo)}`}
            active={choice === p.id}
            onPress={() => setChoice(p.id)}
          />
        ))}
      </View>
      <Button
        title={picked ? `Sponsor for ${money(picked.price_kobo)}` : 'Sponsor'}
        disabled={busy || !choice}
        onPress={() =>
          void run(async () => {
            await request('post', '/listings/{id}/promote', {
              params: { id: listing.id },
              body: { package_id: choice! },
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: {
    backgroundColor: '#e3f4ea',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  badgeSmall: { paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#1f7a45', fontWeight: '800', fontSize: 12 },
  status: { fontSize: 12, fontWeight: '800', color: '#8a5a00' },
  warn: { fontSize: 12, fontWeight: '700', color: '#a33e32' },
  good: { fontSize: 13, fontWeight: '700', color: '#1f7a45' },
  step: { fontSize: 14, fontWeight: '800', color: '#0c3a25', marginTop: 6 },
});
