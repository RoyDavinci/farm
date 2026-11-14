import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Share, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { type Booking, money, statusLabel } from '@farmers-market/shared';
import { api, uploadEvidence } from './api';
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
    const d = await api(`/bookings/${b.id}/dispute`);
    setRecord(d ? await api(`/disputes/${d.id}`) : null);
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
      const r = await api(`/bookings/${b.id}/receipt`);
      await Share.share({
        title: 'Farmers Market receipt',
        message: `Farmers Market ${r.simulated ? 'DEVELOPMENT / SIMULATED ' : ''}receipt\n${r.receipt_number}\n${r.seller}\n${r.title} — ${r.variant}\n${r.quantity} ${r.unit} × ${money(r.unit_price_kobo)}\nTotal: ${money(r.total_kobo)}\nRefunded: ${money(r.refunded_kobo)}\nPayment: wallet\nStatus: ${r.status}`,
      });
    });
  }
  return (
    <View style={s.box}>
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
                    const link = await api(`/evidence/${e.id}/link`);
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
                        await api(`/disputes/${record.id}/return`, 'POST', { action: 'received' });
                      })
                    }
                  >
                    <Text style={s.link}>Confirm I received the returned goods</Text>
                  </Pressable>
                )}
              </>
            )}
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
                  await api(`/bookings/${b.id}/dispute`, 'POST', {
                    reason_code: code,
                    description,
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
  box: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: '#e5eadb' },
  row: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  link: { fontSize: 11, color: '#718b58', paddingVertical: 6 },
  bold: { fontSize: 12, color: '#5d7847', fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 21, color: '#829673' },
  small: { fontSize: 10, lineHeight: 18, color: '#9aa68a' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { fontSize: 9, padding: 8, borderRadius: 14, backgroundColor: '#f0f4e9', color: '#869873' },
  active: { backgroundColor: '#597946', color: '#fff' },
  input: {
    padding: 13,
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#e0e7d4',
    borderRadius: 7,
    backgroundColor: '#fff',
    fontSize: 12,
    color: '#577044',
  },
  button: { padding: 13, borderRadius: 7, backgroundColor: '#42673a', alignItems: 'center' },
  buttonText: { fontSize: 12, color: '#f0f5e5' },
  error: { fontSize: 11, color: '#a16a4c', padding: 10, backgroundColor: '#faeee3' },
});
