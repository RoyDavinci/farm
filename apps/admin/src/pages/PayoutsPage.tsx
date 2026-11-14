import React, { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import { money } from '@farmers-market/shared';
import { api } from '../api';
import { Badge, Empty, Toolbar } from '../ui';
import { useAdmin } from '../AdminContext';

interface Payout {
  id: string;
  seller_name: string;
  business_name: string | null;
  amount_kobo: string;
  fee_kobo: string;
  status: string;
  provider: string | null;
  failure_reason: string | null;
  bank_name: string;
  account_last4: string;
  account_name: string;
  name_match: boolean;
  created_at: string;
}

export default function PayoutsPage() {
  const { busy, action, setError } = useAdmin();
  const [rows, setRows] = useState<Payout[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  const load = useCallback(
    () =>
      api<Payout[]>('/admin/payouts')
        .then(setRows)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => void load(), [load]);
  const act = (fn: () => Promise<unknown>, message: string) =>
    action(async () => {
      await fn();
      await load();
    }, message);
  const visible = rows.filter(
    (p) =>
      (filter === 'ALL' || p.status === filter) &&
      `${p.seller_name} ${p.business_name} ${p.bank_name} ${p.account_name}`
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
        options={['ALL', 'REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED', 'CANCELLED']}
        placeholder="Search sellers or bank accounts"
      />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Seller</th>
              <th>Bank account</th>
              <th>Transfer</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.business_name || p.seller_name}</b>
                  <small>
                    {p.seller_name} · {new Date(p.created_at).toLocaleString()}
                  </small>
                </td>
                <td>
                  {p.bank_name} ••••{p.account_last4}
                  <small className={p.name_match ? '' : 'error'}>
                    {p.account_name}
                    {p.name_match ? '' : ' · name does not match profile'}
                  </small>
                </td>
                <td>
                  <b>{money(Number(p.amount_kobo) - Number(p.fee_kobo))}</b>
                  <small>
                    {money(Number(p.amount_kobo))} requested · {money(Number(p.fee_kobo))} fee
                    {p.provider ? ` · ${p.provider}` : ''}
                  </small>
                </td>
                <td>
                  <Badge status={p.status} />
                  {p.failure_reason && <small>{p.failure_reason}</small>}
                </td>
                <td>
                  {p.status === 'REQUESTED' && (
                    <div className="row-actions">
                      <button
                        className="primary compact"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Send ${money(Number(p.amount_kobo) - Number(p.fee_kobo))} to ${p.account_name} (${p.bank_name} ••••${p.account_last4})?`,
                            )
                          )
                            void act(
                              () => api(`/admin/payouts/${p.id}/approve`, 'POST'),
                              'Payout approved and sent to the provider.',
                            );
                        }}
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt('Reason for rejecting this payout');
                          if (reason)
                            void act(
                              () => api(`/admin/payouts/${p.id}/reject`, 'POST', { reason }),
                              'Payout rejected and funds returned to the seller.',
                            );
                        }}
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  )}
                  {p.status === 'PROCESSING' && p.provider !== 'simulated' && (
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => api(`/admin/payouts/${p.id}/recheck`, 'POST'),
                          'Transfer status checked with the provider.',
                        )
                      }
                    >
                      <RefreshCw size={14} /> Recheck
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <Empty
          title="No payouts to review"
          text="Seller withdrawal requests appear here. Approving one sends a bank transfer."
        />
      )}
    </section>
  );
}
