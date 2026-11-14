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
export default function LedgerPage({ ledger: first }: { ledger: any[] }) {
  const [older, setOlder] = useState<any[]>([]),
    [end, setEnd] = useState(false);
  const ledger = [...first, ...older];
  const loadOlder = () => {
    const last = ledger.at(-1);
    if (!last) return;
    void api<any[]>(
      `/admin/ledger?limit=100&before=${encodeURIComponent(last.cursor)}&before_id=${encodeURIComponent(last.id)}`,
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
      <div className="card-head">
        <div>
          <h2>Ledger entries</h2>
          <p>Amounts are stored in kobo. Every transaction balances to zero.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Reference</th>
              <th>Amount</th>
              <th>Transaction</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.id}>
                <td>
                  <b>{statusLabel(e.account)}</b>
                </td>
                <td>{e.reference.slice(0, 12)}</td>
                <td className={Number(e.amount_kobo) > 0 ? 'positive' : ''}>
                  {Number(e.amount_kobo) > 0 ? '+' : ''}
                  {money(Number(e.amount_kobo))}
                </td>
                <td>
                  <code>{e.txn_id.slice(0, 8)}</code>
                </td>
                <td>{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ledger.length && (
        <Empty
          title="No transactions yet"
          text="Wallet funding, order payments and completed pickups will appear here."
        />
      )}
      {ledger.length >= 100 && !end && (
        <button className="secondary" onClick={loadOlder}>
          Load older entries
        </button>
      )}
    </section>
  );
}
