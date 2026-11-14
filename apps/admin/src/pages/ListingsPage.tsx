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
export default function ListingsPage({ listings }: { listings: Listing[] }) {
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  return (
    <section className="card">
      <Toolbar search={search} setSearch={setSearch} placeholder="Search produce or sellers" />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Produce</th>
              <th>Seller</th>
              <th>Price</th>
              <th>Available stock</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listings
              .filter((l) =>
                `${l.title} ${l.business_name}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((l) => (
                <tr key={l.id}>
                  <td>
                    <b>{l.title}</b>
                    <small>{l.category}</small>
                  </td>
                  <td>{l.business_name}</td>
                  <td>
                    {money(l.price_kobo)} / {l.unit}
                  </td>
                  <td>
                    {l.stock} {l.unit}
                  </td>
                  <td>
                    <Badge status={l.status} />
                  </td>
                  <td>
                    <button
                      disabled={busy}
                      className="secondary compact"
                      onClick={() => {
                        const reason = window.prompt('Reason for changing listing visibility');
                        if (reason)
                          void action(
                            () =>
                              api(`/admin/listings/${l.id}/moderate`, 'POST', {
                                status: l.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                                reason,
                              }),
                            'Listing updated.',
                          );
                      }}
                    >
                      {l.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!listings.length && (
        <Empty
          title="The market is getting ready"
          text="Approved sellers can add their first produce listings from the mobile app."
        />
      )}
    </section>
  );
}
