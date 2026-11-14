import { randomUUID } from 'node:crypto';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';

export interface LedgerPosting {
  account: string;
  owner?: string;
  amount: number;
}
const spendableAccounts = new Set(['wallet', 'seller_payable']);

/**
 * Account locks are independent of the acting user's row: staff refunds and a seller's
 * payout must use exactly the same lock. Transaction-scoped advisory locks also work
 * for an empty account, where there is no ledger row to SELECT FOR UPDATE yet.
 */
export async function lockBalance(q: Query, owner: string, account = 'wallet') {
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 901402))::text', [
    JSON.stringify(['ledger-balance', account, owner]),
  ]);
}
export async function lockedBalance(q: Query, owner: string, account = 'wallet') {
  await lockBalance(q, owner, account);
  return balance(q, owner, account);
}

/** Posts balanced entries atomically. The caller must supply its transaction's Query. */
export async function ledger(q: Query, ref: string, entries: LedgerPosting[]) {
  ensure(
    entries.length >= 2 &&
      entries.every((e) => Number.isSafeInteger(e.amount)) &&
      entries.reduce((sum, e) => sum + e.amount, 0) === 0,
    500,
    'UNBALANCED_LEDGER',
    'Unbalanced ledger transaction',
  );
  const changes = new Map<string, { account: string; owner: string; amount: number }>();
  for (const entry of entries) {
    if (!spendableAccounts.has(entry.account)) continue;
    ensure(entry.owner, 500, 'LEDGER_OWNER_REQUIRED', 'A spendable account needs an owner.');
    const key = JSON.stringify([entry.account, entry.owner]);
    const previous = changes.get(key);
    changes.set(key, {
      account: entry.account,
      owner: entry.owner,
      amount: (previous?.amount || 0) + entry.amount,
    });
  }
  // Every posting uses the same order when multiple spendable accounts are involved.
  const accounts = [...changes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  for (const entry of accounts) await lockBalance(q, entry.owner, entry.account);
  for (const entry of accounts) {
    if (entry.amount >= 0) continue;
    ensure(
      (await balance(q, entry.owner, entry.account)) + entry.amount >= 0,
      409,
      'INSUFFICIENT_BALANCE',
      'The available balance changed. Refresh and try again.',
    );
  }
  const txn = randomUUID();
  for (const entry of entries)
    await q.query(
      'INSERT INTO ledger(id,txn_id,account,owner_id,amount_kobo,reference) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), txn, entry.account, entry.owner || null, entry.amount, ref],
    );
}
export async function balance(q: Query, owner: string, account = 'wallet') {
  const [row] = await q.query<{ balance: string | number | bigint }>(
    'SELECT COALESCE(SUM(amount_kobo),0) AS balance FROM ledger WHERE owner_id=$1 AND account=$2',
    [owner, account],
  );
  const value = Number(row.balance);
  ensure(
    Number.isSafeInteger(value),
    500,
    'BALANCE_RANGE',
    'Balance exceeds the supported integer range.',
  );
  return value;
}
