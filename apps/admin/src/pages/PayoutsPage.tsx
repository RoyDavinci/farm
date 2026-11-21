import { money } from '@ahia/shared';
import { Check, Gavel, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty, Toolbar } from '../ui';

interface Payout {
  id: string;
  seller_name: string;
  business_name: string | null;
  amount_kobo: number;
  fee_kobo: number;
  status: string;
  provider: string | null;
  source_account?: string;
  shopping_request_id?: string | null;
  failure_reason: string | null;
  recovery_error?: string | null;
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
      request('get', '/admin/payouts')
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
                  {p.source_account === 'shopping_advance' && (
                    <small>Shopping goods advance · {p.shopping_request_id?.slice(0, 8)}</small>
                  )}
                  {p.failure_reason && <small>{p.failure_reason}</small>}
                  {p.recovery_error && (
                    <small className="error">
                      {p.recovery_error} Reference: {p.id}
                    </small>
                  )}
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
                              () =>
                                request('post', '/admin/payouts/{id}/approve', {
                                  params: { id: p.id },
                                }),
                              'Payout approved; dispatch and verification are tracked automatically.',
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
                              () =>
                                request('post', '/admin/payouts/{id}/reject', {
                                  params: { id: p.id },
                                  body: { reason },
                                }),
                              'Payout rejected and funds returned to the seller.',
                            );
                        }}
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  )}
                  {p.status === 'PROCESSING' && p.provider !== 'simulated' && (
                    <div className="row-actions">
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              request('post', '/admin/payouts/{id}/recheck', {
                                params: { id: p.id },
                              }),
                            'Transfer status checked with the provider.',
                          )
                        }
                      >
                        <RefreshCw size={14} /> Recheck
                      </button>
                      {p.recovery_error && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => {
                            const paid = window.confirm(
                              `Reference ${p.id}\n\nOK = the provider dashboard shows this transfer was PAID.\nCancel = choose FAILED (funds go back to the seller).`,
                            );
                            const outcome = paid ? 'PAID' : 'FAILED';
                            const reason = window.prompt(
                              `Mark as ${outcome}. What did you confirm in the provider dashboard? (at least 10 characters)`,
                            );
                            if (reason)
                              void act(
                                () =>
                                  request('post', '/admin/payouts/{id}/resolve', {
                                    params: { id: p.id },
                                    body: { outcome, reason },
                                  }),
                                outcome === 'PAID'
                                  ? 'Payout marked as paid.'
                                  : 'Payout marked as failed and funds returned to the seller.',
                              );
                          }}
                        >
                          <Gavel size={14} /> Resolve
                        </button>
                      )}
                    </div>
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
