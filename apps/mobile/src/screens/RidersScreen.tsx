import ParcelPanel from '../ParcelPanel';
import {
  money,
  statusLabel,
  type NearbyRider,
  type ShoppingRequest,
  type ShoppingDetail,
} from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadShoppingReceipt } from '../api';
import ShoppingTracking from '../ShoppingTracking';
import { useApp } from '../AppContext';
import type { Point } from '../location';
import RiderPicker, { PointFields } from '../RiderPicker';
import { request } from '../request';
import { Back, Badge, Button, Chip, Field, s } from '../ui';

export default function RidersScreen() {
  const { me, busy, run } = useApp();
  const [rows, setRows] = useState<ShoppingRequest[]>([]),
    [selected, setSelected] = useState<ShoppingRequest | null>(null);
  const [drop, setDrop] = useState<Point | null>(null),
    [source, setSource] = useState<Point | null>(null),
    [rider, setRider] = useState<NearbyRider | null>(null);
  const [items, setItems] = useState(''),
    [place, setPlace] = useState(''),
    [sourceAddress, setSourceAddress] = useState(''),
    [address, setAddress] = useState(''),
    [budget, setBudget] = useState('');
  const [mode, setMode] = useState<'REIMBURSE' | 'ADVANCE'>('REIMBURSE'),
    [quote, setQuote] = useState<{
      delivery_fee_kobo: number;
      distance_km: number;
      vehicle_name: string;
      rider_name: string;
    } | null>(null),
    [error, setError] = useState('');
  const load = useCallback(
    () =>
      request('get', '/shopping')
        .then(setRows)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);
  if (selected)
    return (
      <ShoppingRequestView
        initial={selected}
        onBack={() => {
          setSelected(null);
          void load();
        }}
      />
    );
  return (
    <>
      <ParcelPanel />
      <Text style={s.eyebrow}>LOCAL RIDERS & SHOPPING</Text>
      <Text style={s.heading}>Buy it. Bring it.</Text>
      <Text style={s.subtitle}>
        Choose a verified rider nearby. Ask them to buy goods from a particular shop or market and
        deliver to you.
      </Text>
      <Text style={s.sectionTitle}>Your shopping requests</Text>
      {!!error && <Text style={s.fine}>{error}</Text>}
      {rows.map((row) => (
        <View key={row.id} style={s.orderCard}>
          <View style={s.rowBetween}>
            <Text style={s.bold}>{row.source_name}</Text>
            <Badge status={row.status} />
          </View>
          <Text style={s.body}>{row.items}</Text>
          <Text style={s.small}>
            {row.buyer_id === me.id
              ? `Rider: ${row.rider_name || 'Selected rider'}`
              : `For: ${row.buyer_name || 'Buyer'}`}{' '}
            · Goods limit {money(row.goods_budget_kobo)} · Delivery {money(row.delivery_fee_kobo)}
          </Text>
          {row.buyer_id !== me.id && (
            <Text style={s.small}>
              Your delivery fee after platform commission:{' '}
              {money(
                row.delivery_fee_kobo -
                  Math.round((row.delivery_fee_kobo * row.commission_bps) / 10000),
              )}
              . Goods reimbursement is separate.
            </Text>
          )}
          {row.review_open && <Text style={s.fine}>Support review in progress</Text>}
          <Button secondary title="Open request & messages" onPress={() => setSelected(row)} />
        </View>
      ))}
      {!rows.length && (
        <Text style={s.body}>Your requests and rider assignments will appear here.</Text>
      )}
      <Button secondary title="Refresh requests" onPress={() => void load()} />
      <Text style={s.sectionTitle}>Find a rider to shop for you</Text>
      <PointFields
        title="Your delivery location"
        value={drop}
        onChange={(p) => {
          setDrop(p);
          setRider(null);
          setQuote(null);
        }}
      />
      <RiderPicker
        point={drop}
        selected={rider}
        onSelect={(r) => {
          setRider(r);
          setQuote(null);
        }}
      />
      {rider && (
        <View style={s.orderCard}>
          <Text style={s.cardTitle}>Request {rider.name}</Text>
          <Field
            label="What should the rider buy?"
            value={items}
            onChangeText={setItems}
            multiline
            placeholder="Items, quantities, brands or acceptable alternatives"
          />
          <Field label="Shop, market or place name" value={place} onChangeText={setPlace} />
          <Field
            label="Shop / collection address"
            value={sourceAddress}
            onChangeText={setSourceAddress}
            multiline
          />
          <PointFields
            title="Shop / collection map pin"
            value={source}
            onChange={(p) => {
              setSource(p);
              setQuote(null);
            }}
          />
          <Field label="Delivery address" value={address} onChangeText={setAddress} multiline />
          <Field
            label="Maximum goods budget (₦), excluding delivery"
            value={budget}
            onChangeText={setBudget}
            keyboardType="decimal-pad"
          />
          <Text style={s.bold}>Proposed payment arrangement</Text>
          <View style={s.chipWrap}>
            <Chip
              title="Rider pays, then is reimbursed"
              active={mode === 'REIMBURSE'}
              onPress={() => setMode('REIMBURSE')}
            />
            <Chip
              title="App advances the goods budget"
              active={mode === 'ADVANCE'}
              onPress={() => setMode('ADVANCE')}
            />
          </View>
          <Text style={s.fine}>
            Discuss this with the rider in the request chat. The goods budget is a hard limit.
            Delivery is shown separately, and no money is taken when you send this request.
          </Text>
          <Button
            secondary
            title="Estimate delivery fee"
            disabled={busy || !source || !drop}
            onPress={() =>
              void run(async () => {
                if (!source || !drop) throw new Error('Set both map pins.');
                setQuote(
                  await request('post', '/shopping/quote', {
                    body: { rider_id: rider.id, source, dropoff: drop },
                  }),
                );
              })
            }
          />
          {quote && (
            <>
              <Text style={s.body}>
                Delivery estimate: {money(quote.delivery_fee_kobo)} · {quote.distance_km} km ·{' '}
                {quote.vehicle_name}
              </Text>
              <Button
                title="Send request & start a conversation"
                disabled={
                  busy ||
                  items.trim().length < 5 ||
                  !place.trim() ||
                  sourceAddress.trim().length < 8 ||
                  address.trim().length < 8 ||
                  !Number.isFinite(Number(budget)) ||
                  Number(budget) <= 0
                }
                onPress={() =>
                  void run(async () => {
                    if (!source || !drop) throw new Error('Set both map pins.');
                    const row = await request('post', '/shopping', {
                      body: {
                        rider_id: rider.id,
                        source,
                        dropoff: drop,
                        items,
                        source_name: place,
                        source_address: sourceAddress,
                        dropoff_address: address,
                        goods_budget_kobo: Math.round(Number(budget) * 100),
                        expected_delivery_fee_kobo: quote.delivery_fee_kobo,
                        payment_mode: mode,
                      },
                    });
                    setSelected(row);
                    await load();
                  }, 'Request sent. Agree the arrangement with your rider before funding.')
                }
              />
            </>
          )}
        </View>
      )}
    </>
  );
}

function ShoppingRequestView({
  initial,
  onBack,
}: {
  initial: ShoppingRequest;
  onBack: () => void;
}) {
  const { me, busy, run, settings, setTab } = useApp();
  const [data, setData] = useState<ShoppingDetail | null>(null),
    [message, setMessage] = useState(''),
    [fee, setFee] = useState(String(initial.delivery_fee_kobo / 100)),
    [mode, setMode] = useState(initial.payment_mode);
  const [cost, setCost] = useState(''),
    [receipt, setReceipt] = useState(''),
    [pin, setPin] = useState(''),
    [advance, setAdvance] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const load = useCallback(
    () => request('get', '/shopping/{id}', { params: { id: initial.id } }).then(setData),
    [initial.id],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [load]);
  const row = data || initial,
    buyer = row.buyer_id === me.id;
  const act = (
    action: string,
    body: Record<string, unknown> = {},
    notice = 'Shopping request updated.',
  ) =>
    run(async () => {
      await request('post', '/shopping/{id}/{action}', { params: { id: row.id, action }, body });
      await load();
    }, notice);
  return (
    <>
      <Back onPress={onBack} />
      <Text style={s.heading}>{row.source_name}</Text>
      <Badge status={row.status} />
      {!!error && <Text style={s.fine}>{error}</Text>}
      <Text style={s.body}>{row.items}</Text>
      <Text style={s.body}>From: {row.source_address}</Text>
      <Text style={s.body}>Deliver to: {row.dropoff_address}</Text>
      <View style={s.orderCard}>
        <Text style={s.bold}>Goods spending limit: {money(row.goods_budget_kobo)}</Text>
        <Text style={s.body}>Delivery fee: {money(row.delivery_fee_kobo)}</Text>
        <Text style={s.body}>
          Funding required: {money(row.goods_budget_kobo + row.delivery_fee_kobo)}
        </Text>
        <Text style={s.small}>
          {row.payment_mode === 'ADVANCE'
            ? 'App advances the goods budget'
            : 'Rider pays the shop and is reimbursed after delivery'}
        </Text>
        <Text style={s.fine}>
          The rider cannot record goods above your limit. Unused budget is returned on completion.
          Delivery commission applies to the fee, not the shop’s goods cost.
        </Text>
      </View>
      {data && <ShoppingTracking row={data} rider={!buyer} />}
      {data && (
        <View style={s.orderCard}>
          <Text style={s.bold}>Receipt photos ({data.receipt_photos.length}/6)</Text>
          <Text style={s.fine}>
            Private to you, the other participant and authorised support staff. Choose up to six
            photos, each under 5 MB.
          </Text>
          {data.receipt_photos.map((photo) => (
            <View key={photo.id}>
              <Image
                source={{ uri: photo.url }}
                style={{ width: '100%', height: 240, resizeMode: 'contain' }}
                accessibilityLabel="Purchase receipt"
              />
              <Button
                secondary
                title="Open full receipt"
                onPress={() =>
                  void run(async () => {
                    const fresh = await request('get', '/shopping/{id}', {
                      params: { id: row.id },
                    });
                    const current = fresh.receipt_photos.find((p) => p.id === photo.id);
                    if (current) await Linking.openURL(current.url);
                  })
                }
              />
            </View>
          ))}
          {!buyer && ['SHOPPING', 'PURCHASED'].includes(row.status) && !row.review_open && (
            <Button
              secondary
              title="Add receipt photo"
              disabled={busy || data.receipt_photos.length >= 6}
              onPress={() =>
                void run(async () => {
                  const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    quality: 0.9,
                  });
                  if (result.canceled) return;
                  const asset = result.assets[0];
                  if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024)
                    throw new Error('Choose a photo under 5 MB.');
                  await uploadShoppingReceipt(row.id, asset);
                  await load();
                })
              }
            />
          )}
        </View>
      )}
      {row.review_open && (
        <View style={s.orderCard}>
          <Text style={s.bold}>Paused for support review</Text>
          <Text style={s.body}>{row.review_note}</Text>
        </View>
      )}
      {!buyer && ['REQUESTED', 'ACCEPTED'].includes(row.status) && !row.review_open && (
        <View style={s.orderCard}>
          <Text style={s.bold}>Agree terms with the buyer</Text>
          <Field
            label="Delivery fee (₦)"
            value={fee}
            onChangeText={setFee}
            keyboardType="decimal-pad"
          />
          <View style={s.chipWrap}>
            <Chip
              title="I pay, then get reimbursed"
              active={mode === 'REIMBURSE'}
              onPress={() => setMode('REIMBURSE')}
            />
            <Chip
              title="Request an app advance"
              active={mode === 'ADVANCE'}
              onPress={() => setMode('ADVANCE')}
            />
          </View>
          <Text style={s.fine}>
            The buyer reviews these terms before funding. Do not exceed the goods budget. Accept
            only if you can reach the specified shop and complete delivery.
          </Text>
          <Button
            title="Agree / send these terms"
            disabled={busy || !Number.isFinite(Number(fee)) || Number(fee) < 0}
            onPress={() =>
              void act('offer', {
                delivery_fee_kobo: Math.round(Number(fee) * 100),
                payment_mode: mode,
              })
            }
          />
        </View>
      )}
      {buyer && row.status === 'ACCEPTED' && !row.review_open && (
        <View style={s.orderCard}>
          {row.payment_mode === 'ADVANCE' && (
            <Text style={s.fine}>
              The rider may request bank payouts from this goods advance. Once paid out, it must be
              returned before cancellation can be refunded. Bank transfers require staff review and
              have the payout fee shown to the rider.
            </Text>
          )}
          <Button
            title={`Fund ${money(row.goods_budget_kobo + row.delivery_fee_kobo)} from wallet`}
            disabled={busy}
            onPress={() =>
              void act(
                'fund',
                { quote_version: row.quote_version },
                'Budget and separate delivery fee funded.',
              )
            }
          />
        </View>
      )}
      {!buyer && row.status === 'SHOPPING' && row.payment_mode === 'ADVANCE' && (
        <View style={s.orderCard}>
          <Text style={s.bold}>
            Request-linked goods advance: {money(data?.advance_available_kobo || 0)}
          </Text>
          <Text style={s.fine}>
            This is the buyer’s shopping budget, not your earnings. Bank payouts require approval.
            The minimum is {money(settings?.payout_min_kobo || 100000)} and the transfer fee is{' '}
            {money(settings?.payout_fee_kobo || 0)}, deducted from the withdrawal. You remain
            responsible for the full goods budget and returning unused funds.
          </Text>
          <Button
            secondary
            title="Set up / check bank account in Wallet"
            onPress={() => setTab('Wallet')}
          />
          <Field
            label="Advance withdrawal amount (₦)"
            value={advance}
            onChangeText={setAdvance}
            keyboardType="decimal-pad"
          />
          <Button
            title="Request advance bank payout"
            disabled={
              busy || !Number.isFinite(Number(advance)) || Number(advance) <= 0 || row.review_open
            }
            onPress={() =>
              void run(async () => {
                await request('post', '/shopping/{id}/advance-payout', {
                  params: { id: row.id },
                  body: { amount_kobo: Math.round(Number(advance) * 100) },
                });
                await load();
              }, 'Advance payout requested. Bank transfers require staff approval.')
            }
          />
          {data?.advance_payouts.map((p) => (
            <Text key={p.id} style={s.small}>
              {money(p.amount_kobo)} · {statusLabel(p.status)}
              {p.failure_reason ? ` · ${p.failure_reason}` : ''}
              {p.recovery_error ? ` · ${p.recovery_error}` : ''}
            </Text>
          ))}
          <Button
            secondary
            title="Return full outstanding advance & cancel"
            disabled={busy}
            onPress={() => void act('return-advance', {}, 'Advance returned and buyer refunded.')}
          />
        </View>
      )}
      {!buyer && row.status === 'SHOPPING' && !row.review_open && (
        <View style={s.orderCard}>
          <Field
            label="Actual goods cost (₦), within the buyer’s limit"
            value={cost}
            onChangeText={setCost}
            keyboardType="decimal-pad"
          />
          <Field
            label="Receipt details / itemised purchase record"
            value={receipt}
            onChangeText={setReceipt}
            multiline
          />
          <Text style={s.fine}>
            Finish any advance payout first. Unused paid-out advance must be returned from your
            wallet; add money there if necessary. Tell the buyer about substitutions in the chat.
          </Text>
          <Button
            title="Record purchase & start delivery"
            disabled={
              busy ||
              !Number.isFinite(Number(cost)) ||
              Number(cost) <= 0 ||
              Number(cost) * 100 > row.goods_budget_kobo ||
              receipt.trim().length < 5
            }
            onPress={() =>
              void act('purchase', {
                actual_goods_kobo: Math.round(Number(cost) * 100),
                receipt_note: receipt,
              })
            }
          />
        </View>
      )}
      {row.actual_goods_kobo != null && (
        <View style={s.orderCard}>
          <Text style={s.body}>Actual goods cost: {money(row.actual_goods_kobo)}</Text>
          <Text style={s.body}>
            Unused goods budget: {money(row.goods_budget_kobo - row.actual_goods_kobo)}
          </Text>
          <Text style={s.body}>{row.receipt_note}</Text>
        </View>
      )}
      {buyer && row.delivery_pin && (
        <View style={s.orderCard}>
          <Text style={s.bold}>Your private delivery PIN</Text>
          <Text style={s.heading}>{row.delivery_pin}</Text>
          <Text style={s.fine}>Share this only after receiving and checking the goods.</Text>
        </View>
      )}
      {!buyer && row.status === 'PURCHASED' && !row.review_open && (
        <View style={s.orderCard}>
          <Field
            label="Buyer’s six-digit delivery PIN"
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            title="Confirm delivery"
            disabled={busy || !/^\d{6}$/.test(pin)}
            onPress={() =>
              void act(
                'deliver',
                { pin },
                'Delivery confirmed; the goods cost, rider fee and unused budget are settled.',
              )
            }
          />
        </View>
      )}
      {['REQUESTED', 'ACCEPTED', 'SHOPPING'].includes(row.status) && !row.review_open && (
        <Button
          secondary
          title="Cancel request"
          disabled={busy}
          onPress={() => void act('cancel')}
        />
      )}
      {!['CANCELLED', 'DELIVERED'].includes(row.status) && (
        <View style={s.orderCard}>
          <Field
            label="Need support? Explain the issue"
            value={reason}
            onChangeText={setReason}
            multiline
          />
          <Button
            secondary
            title="Pause request for support review"
            disabled={busy || reason.trim().length < 5}
            onPress={() => void act('review', { reason })}
          />
        </View>
      )}
      <Text style={s.sectionTitle}>Messages</Text>
      <Text style={s.fine}>
        Discuss goods, alternatives and the payment arrangement here. Sending a chat message does
        not change an agreed budget or delivery fee.
      </Text>
      {data?.messages.map((m) => (
        <View key={m.id} style={s.orderCard}>
          <Text style={s.bold}>
            {m.sender_name || (m.sender_id === me.id ? 'You' : 'Participant')}
          </Text>
          <Text style={s.body}>{m.body}</Text>
        </View>
      ))}
      <Field
        label="Message the buyer / rider"
        value={message}
        onChangeText={setMessage}
        multiline
      />
      <Button
        title="Send message"
        disabled={busy || !message.trim()}
        onPress={() =>
          void run(async () => {
            await request('post', '/shopping/{id}/messages', {
              params: { id: row.id },
              body: { body: message },
            });
            setMessage('');
            await load();
          })
        }
      />
      <Button
        secondary
        title="Refresh request"
        onPress={() => void load().catch((e) => setError(e.message))}
      />
    </>
  );
}
