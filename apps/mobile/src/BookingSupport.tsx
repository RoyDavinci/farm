import AppealPanel from './AppealPanel';
import { type Booking, money, statusLabel } from '@ahia/shared';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { uploadEvidence } from './api';
import { request } from './request';
import { useApp } from './AppContext';
/** Opens (or starts) the chat between the buyer and the seller of this order. */
export function MessageButton({ booking: b, isSeller }: { booking: Booking; isSeller: boolean }) {
  const { openConversation, run, busy } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      style={s.chat}
      onPress={() =>
        void run(async () => {
          const c = await request('post', '/conversations', { body: { booking_id: b.id } });
          openConversation(c.id);
        })
      }
    >
      <Text style={s.chatText}>💬 Message the {isSeller ? 'buyer' : 'seller'}</Text>
    </Pressable>
  );
}

export default function BookingSupport({
  booking: b,
  isSeller,
  onRefresh,
}: {
  booking: Booking;
  isSeller: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [record, setRecord] = useState<any>(null),
    [code, setCode] = useState('OTHER'),
    [description, setDescription] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    const d = await request('get', '/bookings/{id}/dispute', { params: { id: b.id } });
    setRecord(d ? await request('get', '/disputes/{id}', { params: { id: d.id } }) : null);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function receipt() {
    await run(async () => {
      const r = await request('get', '/bookings/{id}/receipt', { params: { id: b.id } });
      await Share.share({
        title: 'Ahia receipt',
        message: `Ahia ${r.simulated ? 'DEVELOPMENT / SIMULATED ' : ''}receipt\n${r.receipt_number}\n${r.seller}\n${r.title} — ${r.variant}\n${r.quantity} ${r.unit} × ${money(r.unit_price_kobo)}\nTotal: ${money(r.total_kobo)}\nRefunded: ${money(r.refunded_kobo)}\nPayment: wallet\nStatus: ${r.status}`,
      });
    });
  }
  return (
    <View style={s.box}>
      <MessageButton booking={b} isSeller={isSeller} />
      <View style={s.row}>
        <Pressable
          disabled={busy}
          onPress={() => {
            setOpen(!open);
            if (!open) void run(load);
          }}
        >
          <Text style={s.link}>
            {open
              ? 'Close support case'
              : b.dispute_status
                ? 'View support case'
                : 'Need help with this booking?'}
          </Text>
        </Pressable>
        {(b.paid || b.status === 'COMPLETED' || b.payment_recorded) && (
          <Pressable disabled={busy} onPress={() => void receipt()}>
            <Text style={s.link}>Share receipt</Text>
          </Pressable>
        )}
      </View>
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {open &&
        (record ? (
          <>
            <Text style={s.bold}>
              Case #{record.id.slice(0, 8)} · {statusLabel(record.status)}
            </Text>
            <Text style={s.body}>
              {statusLabel(record.reason_code)}: {record.description}
            </Text>
            {record.status === 'RESOLVED' && <AppealPanel disputeId={record.id} />}
            {record.return_status !== 'NONE' && (
              <Text style={s.body}>Return: {statusLabel(record.return_status)}</Text>
            )}
            {record.resolution && (
              <>
                <Text style={s.body}>{record.resolution}</Text>
                <Text style={s.bold}>Refund: {money(record.refund_kobo)}</Text>
              </>
            )}
            {record.evidence?.map((e: any) => (
              <Pressable
                key={e.id}
                onPress={() =>
                  void run(async () => {
                    const link = await request('get', '/evidence/{id}/link', {
                      params: { id: e.id },
                    });
                    await Linking.openURL(link.url);
                  })
                }
              >
                <Text style={s.link}>Open private attachment · {e.filename}</Text>
              </Pressable>
            ))}
            {record.status === 'OPEN' && (
              <>
                <Text style={s.small}>
                  Attachments are private to the buyer, seller and support team.
                </Text>
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'],
                        quality: 0.8,
                      });
                      if (!result.canceled) await uploadEvidence(record.id, result.assets[0]);
                    })
                  }
                >
                  <Text style={s.link}>+ Add photo evidence</Text>
                </Pressable>
                {isSeller && record.return_status === 'REQUIRED' && (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/disputes/{id}/return', {
                          params: { id: record.id },
                          body: { action: 'received' },
                        });
                      })
                    }
                  >
                    <Text style={s.link}>Confirm I received the returned goods</Text>
                  </Pressable>
                )}
              </>
            )}
            <CaseThread caseId={record.id} open={record.status === 'OPEN'} />
          </>
        ) : (
          <>
            <Text style={s.bold}>Open a support case</Text>
            <Text style={s.small}>
              Support will review the evidence before approving any refund. An open case pauses
              collection changes and reservation expiry.
            </Text>
            <View style={s.wrap}>
              {[
                'WRONG_ITEM',
                'DAMAGED',
                'MISSING',
                'POOR_QUALITY',
                'NOT_AVAILABLE',
                'NO_SHOW',
                'PAYMENT_ISSUE',
                'OTHER',
              ].map((reason) => (
                <Pressable key={reason} onPress={() => setCode(reason)}>
                  <Text style={[s.chip, code === reason && s.active]}>{statusLabel(reason)}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Support case description"
              style={s.input}
              multiline
              maxLength={4000}
              value={description}
              onChangeText={setDescription}
              placeholder="Explain what happened (at least 10 characters)"
            />
            <Pressable
              style={s.button}
              disabled={busy || description.trim().length < 10}
              onPress={() =>
                void run(async () => {
                  await request('post', '/bookings/{id}/{action}', {
                    params: { id: b.id, action: 'dispute' },
                    body: {
                      reason_code: code,
                      description,
                    },
                  });
                  setDescription('');
                })
              }
            >
              <Text style={s.buttonText}>{busy ? 'Submitting…' : 'Submit support case'}</Text>
            </Pressable>
          </>
        ))}
    </View>
  );
}
const s = StyleSheet.create({
  chat: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#1f754a',
  },
  chatText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  note: { backgroundColor: '#f4fbf8', borderRadius: 10, padding: 10, gap: 3 },
  noteStaff: { backgroundColor: '#eefaf4', borderLeftWidth: 3, borderLeftColor: '#1f754a' },
  noteHead: { fontSize: 11, fontWeight: '700', color: '#325142' },
  box: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: '#d9ece2' },
  row: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  link: { fontSize: 11, color: '#39815d', paddingVertical: 6 },
  bold: { fontSize: 12, color: '#2c704e', fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 21, color: '#52876d' },
  small: { fontSize: 10, lineHeight: 18, color: '#80b098' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { fontSize: 9, padding: 8, borderRadius: 14, backgroundColor: '#e7f6ee', color: '#518a6d' },
  active: { backgroundColor: '#2b724e', color: '#fff' },
  input: {
    padding: 13,
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#d1eade',
    borderRadius: 7,
    backgroundColor: '#fff',
    fontSize: 12,
    color: '#2b684a',
  },
  button: { padding: 13, borderRadius: 7, backgroundColor: '#226242', alignItems: 'center' },
  buttonText: { fontSize: 12, color: '#e3f7ed' },
  error: { fontSize: 11, color: '#a16a4c', padding: 10, backgroundColor: '#faeee3' },
});

const roleName: Record<string, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  staff: 'Ahia support',
  system: 'Ahia',
};

/** The case conversation: buyer, seller and Ahia support updates, newest last. */
function CaseThread({ caseId, open }: { caseId: string; open: boolean }) {
  const [data, setData] = useState<any>(null),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = () =>
    request('get', '/disputes/{id}/timeline', { params: { id: caseId } })
      .then(setData)
      .catch(() => {});
  useEffect(() => void load(), [caseId]);
  if (!data) return null;
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Text style={s.bold}>
        Case conversation · {String(data.priority).toLowerCase()} priority
        {data.assigned_name ? ' · being handled by Ahia support' : ''}
      </Text>
      {data.notes.map((n: any) => (
        <View key={n.id} style={[s.note, n.author_role === 'staff' && s.noteStaff]}>
          <Text style={s.noteHead}>
            {roleName[n.author_role]} · {new Date(n.created_at).toLocaleString()}
          </Text>
          <Text style={s.small}>{n.body}</Text>
        </View>
      ))}
      {open && (
        <>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Reply to the other side and Ahia support"
            accessibilityLabel="Reply on this case"
          />
          {!!error && <Text style={s.error}>{error}</Text>}
          <Pressable
            disabled={busy || text.trim().length < 2}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await request('post', '/disputes/{id}/messages', {
                  params: { id: caseId },
                  body: { body: text.trim() },
                });
                setText('');
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={s.link}>{busy ? 'Sending…' : 'Send reply'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
