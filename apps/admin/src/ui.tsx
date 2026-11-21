import { money, statusLabel, type Booking } from '@ahia/shared';
import { ArrowUpRight, Clock, Package, Search, X } from 'lucide-react';
import React, { useEffect } from 'react';
export function Badge({ status }: { status: string }) {
  return <span className={`badge ${status.toLowerCase()}`}>{statusLabel(status)}</span>;
}
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: any;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="stat">
      <div>
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <h2>{value}</h2>
      <small>{detail}</small>
    </section>
  );
}
export function Empty({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span>{icon || <Package />}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Toolbar({
  search,
  setSearch,
  placeholder,
  filter,
  setFilter,
  options,
}: {
  search: string;
  setSearch: (v: string) => void;
  placeholder: string;
  filter?: string;
  setFilter?: (v: string) => void;
  options?: string[];
}) {
  return (
    <div className="toolbar">
      <label className="search">
        <Search size={17} />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {options && (
        <select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => setFilter?.(e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o === 'ALL' ? 'All statuses' : statusLabel(o)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
export function BookingTable({ rows, open }: { rows: Booking[]; open: (b: Booking) => void }) {
  return (
    <>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Buyer / seller</th>
                <th>Total</th>
                <th>Status</th>
                <th>Payment</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <b>{b.title}</b>
                    <small>
                      {b.quantity} {b.unit} · #{b.id.slice(0, 8)}
                    </small>
                  </td>
                  <td>
                    {b.buyer_name}
                    <small>{b.business_name}</small>
                  </td>
                  <td>{money(b.total_kobo)}</td>
                  <td>
                    <Badge status={b.status} />
                  </td>
                  <td>
                    <span className={b.paid ? 'positive' : 'muted'}>
                      {b.paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon"
                      aria-label={`View booking ${b.id}`}
                      onClick={() => open(b)}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<Clock />}
          title="Ready for the first order"
          text="Bookings will appear here as buyers discover and reserve goods."
        />
      )}
    </>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [close]);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <b>{title}</b>
          <button autoFocus className="icon" aria-label="Close dialog" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
