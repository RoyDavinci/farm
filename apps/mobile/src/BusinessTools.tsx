import { money, type Listing } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from './AppContext';
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

/** Seller: apply for business verification and see its history. */
export function VerificationPanel() {
  const { run, busy } = useApp();
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    legal_name: '',
    registration_number: '',
    contact_person: '',
    contact_phone: '',
    business_address: '',
  });
  const load = () =>
    request('get', '/sellers/me/verification')
      .then((d) => {
        setData(d);
        const det: any = d.details || {};
        setForm((f) => ({
          ...f,
          ...Object.fromEntries(Object.entries(det).filter(([k]) => k in f)),
        }));
      })
      .catch(() => {});
  useEffect(() => void load(), []);
  if (!data) return null;
  const [title, text] = statusCopy[data.status];
  const canApply = ['NONE', 'REJECTED', 'INFO_REQUESTED', 'EXPIRED'].includes(data.status);
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
          {data.requirements.map((r: string) => (
            <Text key={r} style={s.small}>
              • {r}
            </Text>
          ))}
          {data.documents === 0 && (
            <Text style={styles.warn}>Upload at least one document above before applying.</Text>
          )}
          <Field
            label="Registered or trading name"
            value={form.legal_name}
            onChangeText={(v: string) => setForm({ ...form, legal_name: v })}
          />
          <Field
            label="CAC number (if registered)"
            value={form.registration_number}
            onChangeText={(v: string) => setForm({ ...form, registration_number: v })}
          />
          <Field
            label="Person responsible"
            value={form.contact_person}
            onChangeText={(v: string) => setForm({ ...form, contact_person: v })}
          />
          <Field
            label="Phone we can call"
            value={form.contact_phone}
            keyboardType="phone-pad"
            onChangeText={(v: string) => setForm({ ...form, contact_phone: v })}
          />
          <Field
            label="Business address (kept private)"
            value={form.business_address}
            onChangeText={(v: string) => setForm({ ...form, business_address: v })}
          />
          <Button
            title={busy ? 'Sending…' : 'Send for review'}
            disabled={busy || data.documents === 0}
            onPress={() =>
              void run(async () => {
                await request('post', '/sellers/me/verification', { body: form });
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
});
