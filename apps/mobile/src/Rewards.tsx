import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { PinField, pinReady, useTransactionPin } from './TransactionPin';
import { Button, Field, s } from './ui';

/** Copies on the web; opens the share sheet on a phone. */
export async function copyOrShare(text: string, message = text) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return 'copied';
  }
  await Share.share({ message });
  return 'shared';
}

/** The person's Ahia ID: others send money to it, and it is their invite code. */
export function AhiaIdCard() {
  const { me } = useApp();
  const [copied, setCopied] = useState(false);
  if (!me?.ahia_id) return null;
  const copy = () =>
    void copyOrShare(me.ahia_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <View style={styles.idCard}>
      <View style={styles.idTop}>
        <View style={styles.idBadge}>
          <Text style={styles.idBadgeText}>ID</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.idLabel}>Your Ahia ID</Text>
          <Text style={styles.id} selectable>
            {me.ahia_id}
          </Text>
        </View>
      </View>
      <Text style={styles.idHint}>
        Give it to anyone on Ahia to receive money. It’s also your invite code.
      </Text>
      <View style={styles.idActions}>
        <Pressable accessibilityRole="button" style={styles.idButton} onPress={copy}>
          <Text style={styles.idButtonText}>{copied ? '✓ Copied' : 'Copy ID'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.idButton, styles.idButtonSoft]}
          onPress={() =>
            void Share.share({
              message: `Send me money on Ahia. My Ahia ID is ${me.ahia_id}`,
            }).catch(() => {})
          }
        >
          <Text style={[styles.idButtonText, { color: '#1f754a' }]}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Recipient = { ahia_id: string; name: string; business_name: string | null };
type Transfer = {
  id: string;
  amount_kobo: number;
  note: string | null;
  created_at: string;
  direction: 'SENT' | 'RECEIVED';
  other: { ahia_id: string; name: string };
};

/** Send money to another Ahia user by their Ahia ID, confirmed with the transaction PIN. */
export function SendMoneyPanel({ onSent }: { onSent?: () => void }) {
  const { busy, run } = useApp();
  const pinStatus = useTransactionPin();
  const [to, setTo] = useState(''),
    [who, setWho] = useState<Recipient | null>(null),
    [lookupError, setLookupError] = useState(''),
    [amount, setAmount] = useState(''),
    [note, setNote] = useState(''),
    [pin, setPin] = useState(''),
    [history, setHistory] = useState<Transfer[]>([]);
  const loadHistory = useCallback(
    () =>
      request('get', '/wallet/transfers')
        .then((r) => setHistory(r as Transfer[]))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  // Look the ID up as it's typed, so the sender sees whose account it is before sending.
  useEffect(() => {
    // "AH-48213957", "ah48213957" or just the 8 digits.
    const raw = to.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const id = /^\d{8}$/.test(raw)
      ? `AH-${raw}`
      : /^AH\d{8}$/.test(raw)
        ? `AH-${raw.slice(2)}`
        : '';
    setWho(null);
    setLookupError('');
    if (!id) return;
    let current = true;
    const t = setTimeout(
      () =>
        void request('get', '/wallet/transfers/recipient', { query: { id } })
          .then((r) => current && setWho(r as Recipient))
          .catch((e) => current && setLookupError((e as Error).message)),
      300,
    );
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [to]);
  const kobo = Math.round(Number(amount || 0) * 100);
  const missing = !who
    ? ''
    : kobo < 10000
      ? 'Enter at least ₦100.'
      : !pinReady(pin)
        ? 'Enter your 4-digit transaction PIN.'
        : '';
  return (
    <View style={s.orderCard}>
      <Text style={s.cardTitle}>Send money to an Ahia user</Text>
      <Field
        label="Their Ahia ID"
        value={to}
        onChangeText={(v: string) => setTo(v.toUpperCase())}
        autoCapitalize="characters"
        placeholder="e.g. AH-48213957"
        maxLength={13}
      />
      {who && (
        <View style={styles.who}>
          <Text style={styles.whoIcon}>✓</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.bold}>{who.name}</Text>
            <Text style={s.small}>
              {who.ahia_id}
              {who.business_name ? ` · ${who.business_name}` : ''}
            </Text>
          </View>
        </View>
      )}
      {!!lookupError && <Text style={styles.error}>{lookupError}</Text>}
      {who && (
        <>
          <Field
            label="Amount (₦)"
            value={amount}
            onChangeText={(v: string) => setAmount(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="e.g. 5000"
          />
          <Field
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={100}
            placeholder="What it's for"
          />
          {pinStatus.state && !pinStatus.state.set ? (
            <Text style={styles.error}>
              Set a transaction PIN in Wallet first; it protects every transfer.
            </Text>
          ) : (
            <PinField value={pin} onChange={setPin} />
          )}
          {!!missing && !!amount && <Text style={styles.error}>{missing}</Text>}
          <Button
            title={kobo >= 10000 ? `Send ${money(kobo)} to ${who.name}` : 'Send money'}
            disabled={busy || !!missing}
            onPress={() =>
              void run(
                async () => {
                  await request('post', '/wallet/transfers', {
                    body: {
                      to: who.ahia_id,
                      amount_kobo: kobo,
                      ...(note.trim() ? { note: note.trim() } : {}),
                      transaction_pin: pin,
                    } as any,
                  });
                  setAmount('');
                  setNote('');
                  setPin('');
                  setTo('');
                  await loadHistory();
                  onSent?.();
                },
                `Sent ${money(kobo)} to ${who.name}.`,
              )
            }
          />
        </>
      )}
      <Text style={s.fine}>
        Money you added by card in the last day, and Ahia credit from rewards, can be spent in the
        app but not sent until its hold ends.
      </Text>
      {!!history.length && <Text style={s.bold}>Transfers</Text>}
      {history.slice(0, 10).map((t) => (
        <View key={t.id} style={styles.transfer}>
          <View style={{ flex: 1 }}>
            <Text style={s.bold}>
              {t.direction === 'SENT' ? `To ${t.other.name}` : `From ${t.other.name}`}
            </Text>
            <Text style={s.small}>
              {t.other.ahia_id} · {new Date(t.created_at).toLocaleDateString()}
              {t.note ? ` · ${t.note}` : ''}
            </Text>
          </View>
          <Text style={[s.bold, t.direction === 'RECEIVED' && { color: '#1f754a' }]}>
            {t.direction === 'SENT' ? '−' : '+'}
            {money(t.amount_kobo)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Type a promo code: instant Ahia credit, or cashback on the next completed order. */
export function PromoCodeCard() {
  const { busy, run } = useApp();
  const [code, setCode] = useState(''),
    [done, setDone] = useState(''),
    [mine, setMine] = useState<any[]>([]);
  const load = useCallback(
    () =>
      request('get', '/promo-codes/mine')
        .then((r) => setMine(r as any[]))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const waiting = mine.filter((p) => p.status === 'PENDING');
  return (
    <View style={s.orderCard}>
      <Text style={s.cardTitle}>🎟️ Have a promo code?</Text>
      <View style={styles.promoRow}>
        <TextInput
          style={styles.promoInput}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          placeholder="Enter code"
          placeholderTextColor="#8aa698"
          accessibilityLabel="Promo code"
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || code.trim().length < 3}
          style={[styles.apply, (busy || code.trim().length < 3) && { opacity: 0.5 }]}
          onPress={() =>
            void run(async () => {
              setDone('');
              const r = (await request('post', '/promo-codes/redeem', {
                body: { code: code.trim() },
              })) as any;
              setCode('');
              setDone(`✓ ${r.code}: ${r.message}`);
              await load();
            })
          }
        >
          <Text style={styles.applyText}>Apply</Text>
        </Pressable>
      </View>
      {!!done && <Text style={styles.done}>{done}</Text>}
      {waiting.map((p) => (
        <Text key={p.id} style={s.small}>
          ⏳ {p.code}: {p.percent}% back
          {p.max_kobo ? ` (up to ${money(p.max_kobo)})` : ''} on your next completed order
          {p.min_order_kobo ? ` of ${money(p.min_order_kobo)}+` : ''}
          {p.ends_at ? `, until ${new Date(p.ends_at).toLocaleDateString()}` : ''}.
        </Text>
      ))}
    </View>
  );
}

type Referrals = {
  code: string;
  link: string;
  reward_kobo: number;
  welcome_kobo: number;
  min_order_kobo: number;
  hold_days: number;
  earned_kobo: number;
  invited: number;
  rewarded: number;
  people: { name: string; joined_at: string; rewarded: boolean }[];
};

/** "Invite friends": the person's referral link, what each side gets, and who joined. */
export function InviteCard() {
  const [data, setData] = useState<Referrals | null>(null),
    [copied, setCopied] = useState(false),
    [showPeople, setShowPeople] = useState(false);
  useEffect(() => {
    void request('get', '/referrals/me')
      .then((r) => setData(r as Referrals))
      .catch(() => {});
  }, []);
  if (!data) return null;
  const message = `Join me on Ahia: buy from sellers near you and get it delivered. Sign up with my link and get ${money(data.welcome_kobo)} after your first order: ${data.link}`;
  const steps = [
    ['🔗', 'Share your link'],
    ['🛒', `Friend orders ${money(data.min_order_kobo)}+`],
    ['🎉', `You both get ${money(data.reward_kobo)}`],
  ];
  return (
    <View style={styles.invite}>
      <View style={styles.inviteHead}>
        <View style={styles.giftCircle}>
          <Text style={{ fontSize: 26 }}>🎁</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.inviteTitle}>Invite friends, earn {money(data.reward_kobo)}</Text>
          <Text style={styles.inviteSub}>
            Your friend gets {money(data.welcome_kobo)} too, after their first order.
          </Text>
        </View>
      </View>
      <View style={styles.steps}>
        {steps.map(([icon, label], i) => (
          <View key={label} style={styles.step}>
            <Text style={styles.stepIcon}>{icon}</Text>
            <Text style={styles.stepText}>{label}</Text>
            {i < steps.length - 1 && <Text style={styles.stepArrow}>›</Text>}
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        style={styles.linkBox}
        onPress={() =>
          void copyOrShare(data.link, message).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
        }
      >
        <Text style={styles.link} numberOfLines={1}>
          {data.link.replace(/^https?:\/\//, '')}
        </Text>
        <Text style={styles.linkCopy}>{copied ? '✓ Copied' : 'Copy'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.shareButton}
        onPress={() => void Share.share({ message }).catch(() => {})}
      >
        <Text style={styles.shareText}>Share invite link</Text>
      </Pressable>
      <Pressable style={styles.stats} onPress={() => setShowPeople(!showPeople)}>
        {[
          [String(data.invited), 'Joined'],
          [String(data.rewarded), 'Rewarded'],
          [money(data.earned_kobo), 'Earned'],
        ].map(([n, label]) => (
          <View key={label} style={styles.stat}>
            <Text style={styles.statNumber}>{n}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </Pressable>
      {showPeople &&
        data.people.map((p, i) => (
          <Text key={i} style={styles.person}>
            {p.rewarded ? '✅' : '⏳'} {p.name} · joined{' '}
            {new Date(p.joined_at).toLocaleDateString()}
            {p.rewarded ? '' : ' · waiting for their first order'}
          </Text>
        ))}
      {!!data.people.length && (
        <Pressable onPress={() => setShowPeople(!showPeople)}>
          <Text style={styles.personToggle}>{showPeople ? 'Hide' : 'See'} who joined</Text>
        </Pressable>
      )}
      <Text style={styles.inviteFine}>
        Rewards are Ahia credit: spend them straight away; they can be withdrawn after{' '}
        {data.hold_days} days.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  idCard: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dcece3',
    gap: 12,
  },
  idTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  idBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7f3ed',
  },
  idBadgeText: { color: '#1f754a', fontWeight: '900', fontSize: 15, letterSpacing: 1 },
  idLabel: { fontSize: 12, fontWeight: '700', color: '#5f8471' },
  id: { fontSize: 26, fontWeight: '800', letterSpacing: 1.5, color: '#143d29' },
  idHint: { fontSize: 13, lineHeight: 19, color: '#5f7e6f' },
  idActions: { flexDirection: 'row', gap: 10 },
  idButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#1f754a',
  },
  idButtonSoft: { backgroundColor: '#e7f3ed' },
  idButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#eef8f2',
  },
  whoIcon: {
    width: 28,
    height: 28,
    lineHeight: 28,
    borderRadius: 14,
    textAlign: 'center',
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: '#1f754a',
    fontWeight: '800',
  },
  error: { fontSize: 13, color: '#b3261e', fontWeight: '600' },
  done: { fontSize: 14, color: '#1f754a', fontWeight: '700' },
  transfer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#eef4f0',
  },
  promoRow: { flexDirection: 'row', gap: 10 },
  promoInput: {
    flex: 1,
    minWidth: 0,
    padding: 13,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 12,
    backgroundColor: '#fff',
    fontSize: 15,
    letterSpacing: 1,
    fontWeight: '700',
  },
  apply: {
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#1f754a',
  },
  applyText: { color: '#fff', fontWeight: '800' },
  invite: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#fff8ea',
    borderWidth: 1,
    borderColor: '#f3e2bb',
    gap: 14,
  },
  inviteHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  giftCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffe9b8',
  },
  inviteTitle: { fontSize: 19, fontWeight: '800', color: '#3d2a05' },
  inviteSub: { fontSize: 13, lineHeight: 19, color: '#7a5d22', marginTop: 2 },
  steps: { flexDirection: 'row', gap: 6 },
  step: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stepIcon: { fontSize: 16 },
  stepText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#5c4614' },
  stepArrow: { fontSize: 18, color: '#c9a65a' },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#e2c983',
  },
  link: { flex: 1, color: '#3d2a05', fontWeight: '600', fontSize: 14 },
  linkCopy: { color: '#1f754a', fontWeight: '800' },
  shareButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#1f754a',
  },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  statNumber: { fontSize: 18, fontWeight: '800', color: '#143d29' },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#7a5d22' },
  person: { fontSize: 13, color: '#5c4614' },
  personToggle: { fontSize: 13, fontWeight: '700', color: '#1f754a' },
  inviteFine: { fontSize: 11, lineHeight: 16, color: '#8a6f35' },
});
