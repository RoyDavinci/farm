import { type Booking } from '@zuru/shared';
import { useState } from 'react';
import { useAdmin } from '../AdminContext';
import { BookingTable, Toolbar } from '../ui';
export default function BookingsPage({ bookings }: { bookings: Booking[] }) {
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  const bookingRows = bookings.filter(
    (b) =>
      (filter === 'ALL' || b.status === filter) &&
      `${b.title} ${b.business_name} ${b.buyer_name} ${b.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="card">
      <Toolbar
        search={search}
        setSearch={setSearch}
        filter={filter}
        setFilter={setFilter}
        options={[
          'ALL',
          'REQUESTED',
          'ACCEPTED',
          'READY_FOR_PICKUP',
          'COMPLETED',
          'EXPIRED',
          'CANCELLED',
          'DECLINED',
        ]}
        placeholder="Search orders, buyers or sellers"
      />
      <BookingTable rows={bookingRows} open={openTimeline} />
    </section>
  );
}
