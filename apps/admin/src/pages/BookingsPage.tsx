import React, { useState } from 'react';
import {
  Sprout,
  Store,
  ShoppingBag,
  Package,
  Settings,
  ScrollText,
  Wallet,
  ArrowUpRight,
  Search,
  Check,
  ChevronRight,
  Clock,
  X,
  ShieldCheck,
} from 'lucide-react';
import {
  money,
  statusLabel,
  type Seller,
  type Booking,
  type Listing,
  type Settings as MarketSettings,
  type OrderEvent,
} from '@farmers-market/shared';
import { api } from '../api';
import { Badge, Stat, Empty, Toolbar, BookingTable } from '../ui';
import { useAdmin } from '../AdminContext';
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
