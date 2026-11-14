import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { money, type Booking } from '@farmers-market/shared';
export default function CounterofferPanel({
  booking: b,
  isSeller,
  busy,
  onAction,
}: {
  booking: Booking;
  isSeller: boolean;
  busy: boolean;
  onAction: (action: string, body?: object) => void;
}) {
  const [open, setOpen] = useState(false),
    [quantity, setQuantity] = useState(String(b.offer_quantity || b.quantity)),
    [price, setPrice] = useState(String((b.offer_price_kobo || b.price_kobo) / 100)),
    [note, setNote] = useState('');
  return (
    <View style={s.box}>
      {b.status === 'COUNTERED' && (
        <>
          <Text style={s.bold}>Seller’s revised offer</Text>
          <Text style={s.body}>
            {b.offer_quantity} {b.unit} at {money(b.offer_price_kobo || 0)} each
          </Text>
          <Text style={s.price}>
            Total {money((b.offer_quantity || 0) * (b.offer_price_kobo || 0))}
          </Text>
          <Text style={s.body}>{b.offer_note}</Text>
          <Text style={s.small}>
            No stock is held until the buyer approves. Offer expires{' '}
            {b.offer_expires_at ? new Date(b.offer_expires_at).toLocaleString() : 'soon'}.
          </Text>
          {!isSeller && (
            <>
              <Pressable
                disabled={busy}
                style={s.button}
                onPress={() => onAction('approve-change', { offer_version: b.offer_version || 0 })}
              >
                <Text style={s.buttonText}>Approve terms & reserve stock</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => onAction('decline-change')}>
                <Text style={s.link}>Decline revised offer</Text>
              </Pressable>
            </>
          )}
        </>
      )}
      {isSeller && ['REQUESTED', 'COUNTERED'].includes(b.status) && (
        <>
          <Pressable disabled={busy} onPress={() => setOpen(!open)}>
            <Text style={s.link}>
              {open
                ? 'Close offer editor'
                : b.status === 'COUNTERED'
                  ? 'Revise this offer'
                  : 'Propose a different quantity or price'}
            </Text>
          </Pressable>
          {open && (
            <>
              <TextInput
                style={s.input}
                accessibilityLabel="Counteroffer quantity"
                keyboardType="number-pad"
                value={quantity}
                onChangeText={setQuantity}
                placeholder="Quantity"
              />
              <TextInput
                style={s.input}
                accessibilityLabel="Counteroffer unit price"
                keyboardType="decimal-pad"
                value={price}
                onChangeText={setPrice}
                placeholder="Unit price ₦"
              />
              <TextInput
                style={s.input}
                accessibilityLabel="Counteroffer note"
                value={note}
                onChangeText={setNote}
                placeholder="Explain the revised offer"
                maxLength={500}
              />
              <Pressable
                disabled={busy || note.trim().length < 3}
                style={s.button}
                onPress={() =>
                  onAction('counter', {
                    quantity: Number(quantity),
                    price_kobo: Math.round(Number(price) * 100),
                    note,
                  })
                }
              >
                <Text style={s.buttonText}>Send counteroffer</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  box: {
    gap: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e6e1c6',
    borderRadius: 9,
    backgroundColor: '#fbf9ee',
  },
  bold: { fontSize: 13, color: '#8d804d', fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 20, color: '#8a8c70' },
  price: { fontSize: 18, color: '#687d4e', fontWeight: '600' },
  small: { fontSize: 10, lineHeight: 18, color: '#9ba185' },
  input: {
    padding: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e3cb',
    borderRadius: 7,
    fontSize: 12,
    color: '#657a4c',
  },
  link: { fontSize: 11, color: '#8e814e', padding: 5 },
  button: { padding: 13, borderRadius: 7, backgroundColor: '#496b3d', alignItems: 'center' },
  buttonText: { color: '#f0f5e7', fontSize: 12, fontWeight: '600' },
});
