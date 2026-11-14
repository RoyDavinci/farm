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
export default function AuditPage({ audit: first }: { audit: any[] }) {
  const [older, setOlder] = useState<any[]>([]),
    [end, setEnd] = useState(false);
  const audit = [...first, ...older];
  const loadOlder = () => {
    const last = audit.at(-1);
    if (!last) return;
    void api<any[]>(
      `/admin/audit?limit=100&before=${encodeURIComponent(last.cursor)}&before_id=${encodeURIComponent(last.id)}`,
    ).then((rows) => {
      setOlder((o) => [...o, ...rows]);
      if (rows.length < 100) setEnd(true);
    });
  };
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  return (
    <section className="card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Details</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td>
                  <b>{a.action}</b>
                  <small>{a.entity_id.slice(0, 12)}</small>
                </td>
                <td>{a.actor_name || 'System'}</td>
                <td className="metadata">{JSON.stringify(a.metadata)}</td>
                <td>{new Date(a.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!audit.length && (
        <Empty
          title="A clear trail starts here"
          text="Approvals, changes and payment actions will be recorded automatically."
        />
      )}
      {audit.length >= 100 && !end && (
        <button className="secondary" onClick={loadOlder}>
          Load older entries
        </button>
      )}
    </section>
  );
}
