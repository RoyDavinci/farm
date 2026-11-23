import ReturnJourneysPanel from '../ReturnJourneysPanel';
import PreorderInterestPanel from '../PreorderInterestPanel';
import { statusLabel, type Booking, type OrderEvent } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { featureOn } from '../features';
import { useI18n } from '../i18n';
import { Back, Empty, s } from '../ui';
import BookingCard from './BookingCard';

/** Orders that still need the seller to act (accept, mark ready, hand over). */
const sellerToDo = new Set(['REQUESTED', 'ACCEPTED', 'PAID', 'READY']);

/**
 * Orders. Sellers get two tabs: "Received" (orders from buyers, where they accept, decline and
 * hand over) and "My purchases". Opening an order from a notification lands on its tab with that
 * order first.
 */
export function BookingsScreen({
  outgoing,
  incoming = [],
  focusId = null,
}: {
  outgoing: Booking[];
  incoming?: Booking[];
  focusId?: string | null;
}) {
  const { t } = useI18n();
  const { settings, seller } = useApp();
  const showsReceived = !!seller || incoming.length > 0;
  const [section, setSection] = useState<'received' | 'purchases'>(() =>
    focusId
      ? incoming.some((b) => b.id === focusId)
        ? 'received'
        : 'purchases'
      : showsReceived && incoming.some((b) => sellerToDo.has(b.status))
        ? 'received'
        : 'purchases',
  );
  useEffect(() => {
    if (focusId) setSection(incoming.some((b) => b.id === focusId) ? 'received' : 'purchases');
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = incoming.filter((b) => b.status === 'REQUESTED').length;
  const focusFirst = (rows: Booking[]) =>
    focusId ? [...rows].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : rows;
  const received = section === 'received' && showsReceived;
  const rows = focusFirst(received ? incoming : outgoing);
  return (
    <>
      <Text style={s.eyebrow}>{t('bookings.eyebrow')}</Text>
      <Text style={s.heading}>{t('bookings.heading')}</Text>
      <Text style={s.subtitle}>
        {received
          ? 'Orders buyers placed with your shop. Accept to reserve the stock for them.'
          : t('bookings.subtitle')}
      </Text>
      {showsReceived && (
        <View style={tabStyles.tabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: received }}
            style={[tabStyles.tab, received && tabStyles.active]}
            onPress={() => setSection('received')}
          >
            <Text style={s.bold}>Received{waiting ? ` · ${waiting} new` : ''}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: !received }}
            style={[tabStyles.tab, !received && tabStyles.active]}
            onPress={() => setSection('purchases')}
          >
            <Text style={s.bold}>My purchases</Text>
          </Pressable>
        </View>
      )}
      {!received && featureOn(settings, 'preorders') && <PreorderInterestPanel />}
      {!received && <ReturnJourneysPanel />}
      {rows.length ? (
        rows.map((b) => <BookingCard key={b.id} booking={b} isSeller={received} />)
      ) : received ? (
        <Empty
          title="No orders yet"
          text="When a buyer orders from your shop, it appears here for you to accept."
        />
      ) : (
        <Empty title={t('bookings.emptyTitle')} text={t('bookings.emptyText')} />
      )}
    </>
  );
}
export function HistoryView({
  history,
  onBack,
}: {
  history: { booking: Booking; events: OrderEvent[] };
  onBack: () => void;
}) {
  return (
    <>
      <Back onPress={onBack} />
      <Text style={s.heading}>Every step of the journey</Text>
      <Text style={s.subtitle}>
        {history.booking.title} · #{history.booking.id.slice(0, 8)}
      </Text>
      {history.events.map((e) => (
        <View key={e.id} style={s.timeline}>
          <Text style={s.bold}>{statusLabel(e.to_status)}</Text>
          <Text style={s.body}>{e.reason}</Text>
          <Text style={s.small}>{new Date(e.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </>
  );
}

const tabStyles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#d7eae0' },
  tab: { flex: 1, padding: 13, alignItems: 'center' },
  active: { borderBottomWidth: 3, borderColor: '#1f754a' },
});
