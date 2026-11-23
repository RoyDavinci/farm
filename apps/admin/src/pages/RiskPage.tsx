import { Check, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Empty, Toolbar } from '../ui';

const KIND: Record<string, string> = {
  SHARED_DEVICE: 'Shares a device',
  MANY_ACCOUNTS_ONE_DEVICE: 'Many accounts on one device',
  ACCOUNT_FARM: 'New accounts from one device',
  SHARED_BANK_ACCOUNT: 'Shares a bank account',
  BANK_NAME_MISMATCH: 'Bank name doesn’t match',
  DEPOSIT_THEN_WITHDRAW: 'Withdrew soon after a card top-up',
  SELF_DEALING: 'Orders from a linked seller',
  COLLUSION_RISK: 'Rider linked to buyer or seller',
  OFF_PLATFORM_PAYMENT: 'Asks to pay outside Ahia',
  POD_REFUSED: 'Refused pay on delivery',
  EVIDENCE_LOCATION: 'Delivery photo far from address',
  BVN_NAME_MISMATCH: 'BVN name doesn’t match',
  BVN_WATCHLISTED: 'BVN on bank watch-list',
  NIN_MISMATCH: 'NIN doesn’t match BVN',
};

/**
 * Risk queue: automatic fraud flags (linked devices and bank accounts, odd money patterns, BVN
 * problems, refusals). Staff clear a flag with a note, freeze or unfreeze the account, or allow a
 * bank account whose name doesn't match after checking it.
 */
export default function RiskPage() {
  const { busy, action, setError } = useAdmin();
  const [status, setStatus] = useState<'OPEN' | 'CLEARED'>('OPEN'),
    [rows, setRows] = useState<any[]>([]),
    [search, setSearch] = useState('');
  const load = useCallback(
    () =>
      void request('get', '/admin/risk', { query: { status } as any })
        .then((r) => setRows(r as any[]))
        .catch((e) => setError((e as Error).message)),
    [status, setError],
  );
  useEffect(load, [load]);
  const act = (fn: () => Promise<unknown>, message: string) =>
    void action(async () => {
      await fn();
      load();
    }, message);
  const shown = rows.filter((r) =>
    `${r.user.name} ${r.user.email} ${r.kind} ${r.detail}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="card">
      <Toolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search name, email or flag"
        options={['OPEN', 'CLEARED']}
        filter={status}
        setFilter={(v: string) => setStatus(v as 'OPEN' | 'CLEARED')}
      />
      {!shown.length ? (
        <Empty
          title={status === 'OPEN' ? 'All clear' : 'No cleared flags'}
          text={status === 'OPEN' ? 'Nothing needs a look right now.' : 'Cleared flags show here.'}
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Flag</th>
                <th>Account</th>
                <th>Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span
                      className={`badge ${r.severity === 'HIGH' ? 'danger' : r.severity === 'MEDIUM' ? 'warning' : ''}`}
                    >
                      {r.severity}
                    </span>
                    <b>{KIND[r.kind] || r.kind}</b>
                    <small>{new Date(r.created_at).toLocaleString()}</small>
                  </td>
                  <td>
                    <b>{r.user.name}</b>
                    <small>
                      {r.user.email} · {r.user.phone || 'no phone'}
                    </small>
                    <small>
                      {r.user.frozen ? '⛔ Frozen · ' : ''}
                      {r.user.bvn_verified ? 'BVN verified · ' : 'BVN not verified · '}
                      {r.user.open_flags} open flag{r.user.open_flags === 1 ? '' : 's'} · joined{' '}
                      {new Date(r.user.joined_at).toLocaleDateString()}
                    </small>
                  </td>
                  <td>
                    {r.detail}
                    {r.related && <small>Linked account: {r.related.name || r.related.id}</small>}
                    {r.kind === 'BANK_NAME_MISMATCH' && r.payout_account && (
                      <small>
                        {r.payout_account.bank_name} ••••{r.payout_account.last4} ·{' '}
                        {r.payout_account.account_name}
                        {r.payout_account.allowed ? ' · allowed' : ''}
                      </small>
                    )}
                    {r.status === 'CLEARED' && (
                      <small>
                        Cleared by {r.cleared_by} · {r.note}
                      </small>
                    )}
                  </td>
                  <td>
                    {r.status === 'OPEN' && (
                      <div className="row-actions">
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => {
                            const note = window.prompt(
                              'What did you check? (kept in the audit log)',
                            );
                            if (note)
                              act(
                                () =>
                                  request('post', '/admin/risk/{id}/clear', {
                                    params: { id: r.id },
                                    body: { note },
                                  }),
                                'Flag cleared.',
                              );
                          }}
                        >
                          <Check size={14} /> Clear
                        </button>
                        {r.kind === 'BANK_NAME_MISMATCH' &&
                          r.payout_account &&
                          !r.payout_account.allowed && (
                            <button
                              className="secondary compact"
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt(
                                  `Allow withdrawals to “${r.payout_account.account_name}”? Say how you checked it.`,
                                );
                                if (reason)
                                  act(
                                    () =>
                                      request('post', '/admin/payout-accounts/{id}/allow', {
                                        params: { id: r.payout_account.id },
                                        body: { reason },
                                      }),
                                    'Bank account allowed.',
                                  );
                              }}
                            >
                              <ShieldCheck size={14} /> Allow account
                            </button>
                          )}
                        {r.user.frozen ? (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt('Why unfreeze?');
                              if (reason)
                                act(
                                  () =>
                                    request('post', '/admin/users/{id}/unfreeze', {
                                      params: { id: r.user.id },
                                      body: { reason },
                                    }),
                                  'Account unfrozen.',
                                );
                            }}
                          >
                            <LockOpen size={14} /> Unfreeze
                          </button>
                        ) : (
                          <button
                            className="danger compact"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt(
                                `Freeze ${r.user.name}? Withdrawals, orders and delivery jobs stop. Reason:`,
                              );
                              if (reason)
                                act(
                                  () =>
                                    request('post', '/admin/users/{id}/freeze', {
                                      params: { id: r.user.id },
                                      body: { reason },
                                    }),
                                  'Account frozen.',
                                );
                            }}
                          >
                            <Lock size={14} /> Freeze
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
      )}
    </section>
  );
}
