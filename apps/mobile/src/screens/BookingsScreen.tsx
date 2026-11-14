import { statusLabel, type Booking, type OrderEvent } from '@farmers-market/shared';
import { Text, View } from 'react-native';
import { useI18n } from '../i18n';
import { Back, Empty, s } from '../ui';
import BookingCard from './BookingCard';

export function BookingsScreen({ outgoing }: { outgoing: Booking[] }) {
  const { t } = useI18n();
  return (
    <>
      <Text style={s.eyebrow}>{t('bookings.eyebrow')}</Text>
      <Text style={s.heading}>{t('bookings.heading')}</Text>
      <Text style={s.subtitle}>{t('bookings.subtitle')}</Text>
      {outgoing.length ? (
        outgoing.map((b) => <BookingCard key={b.id} booking={b} isSeller={false} />)
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
