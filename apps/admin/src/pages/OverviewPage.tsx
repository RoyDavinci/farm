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
export default function OverviewPage({
  overview,
  sellers,
  bookings,
  settings,
}: {
  overview: any;
  sellers: Seller[];
  bookings: Booking[];
  settings: MarketSettings | null;
}) {
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  const pending = sellers.filter((s) => s.status === 'PENDING');
  return (
    <>
      <div className="stats">
        <Stat
          label="Approved sellers"
          value={overview?.sellers.approved ?? '—'}
          detail="Ready to sell"
          icon={<Store />}
        />
        <Stat
          label="Active reservations"
          value={overview?.orders.active ?? '—'}
          detail="Stock held for collection"
          icon={<ShoppingBag />}
        />
        <Stat
          label="Completed pickups"
          value={overview?.orders.completed ?? '—'}
          detail="Confirmed with buyer code"
          icon={<Package />}
        />
        <Stat
          label="Platform earnings"
          value={money(overview?.revenue_kobo || 0)}
          detail={`${(settings?.commission_bps || 500) / 100}% commission on completed pickups`}
          icon={<Wallet />}
        />
      </div>
      <div className="overview-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>A good start begins with trust</h2>
              <p>Sellers waiting for your review</p>
            </div>
            <button className="text-button" onClick={() => go('Sellers')}>
              View all <ArrowUpRight size={16} />
            </button>
          </div>
          {pending.length === 0 ? (
            <Empty
              icon={<ShieldCheck />}
              title="You’re all caught up"
              text="New seller applications will appear here for review."
            />
          ) : (
            pending.slice(0, 4).map((s) => (
              <button className="seller-row" key={s.user_id} onClick={() => openReview(s)}>
                <span className="seller-avatar">{s.business_name.slice(0, 1)}</span>
                <span>
                  <b>{s.business_name}</b>
                  <small>
                    {s.area}, {s.city} · {statusLabel(s.business_type)}
                  </small>
                </span>
                <Badge status={s.status} />
                <ChevronRight size={16} />
              </button>
            ))
          )}
        </section>
        <section className="green-card">
          <span className="eyebrow">THE MARKETPLACE PROMISE</span>
          <Sprout size={42} />
          <h2>
            From fresh harvest
            <br />
            to happy handover.
          </h2>
          <p>
            Verified sellers. Reserved stock.
            <br />A secure code for every pickup.
          </p>
          <button onClick={() => go('Bookings')}>
            Follow the journey <ArrowUpRight size={18} />
          </button>
          <div className="green-lines" />
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Latest bookings</h2>
            <p>What’s moving through your market</p>
          </div>
          <button className="text-button" onClick={() => go('Bookings')}>
            All bookings <ArrowUpRight size={16} />
          </button>
        </div>
        <BookingTable rows={bookings.slice(0, 5)} open={openTimeline} />
      </section>
    </>
  );
}
