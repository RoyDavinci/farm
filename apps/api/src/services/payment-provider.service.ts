import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config/index.js';
import { AppError, ensure } from '../lib/errors.js';
export type Provider = 'paystack' | 'flutterwave';
async function request(url: string, secret: string, body?: object) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError(
      503,
      'PROVIDER_UNAVAILABLE',
      'The payment provider is temporarily unreachable.',
    );
  }
  if (res.status >= 500)
    throw new AppError(
      503,
      'PROVIDER_UNAVAILABLE',
      'The payment provider is temporarily unavailable.',
    );
  const data: any = await res.json().catch(() => null);
  ensure(
    res.ok && data && data.status !== false && data.status !== 'error',
    502,
    'PROVIDER_REJECTED',
    'The payment provider could not process this request.',
  );
  return data.data;
}
/** Missing IDs must stay absent so reference-based recovery can locate the transfer later. */
function transferId(provider: Provider, data: any) {
  const id = provider === 'paystack' ? data?.transfer_code : data?.id;
  ensure(
    (typeof id === 'string' && id.trim().length > 0) ||
      (typeof id === 'number' && Number.isSafeInteger(id) && id > 0),
    502,
    'TRANSFER_ID_MISSING',
    'The provider did not return a transfer identifier.',
  );
  return String(id);
}
export type TransferStatus = 'PROCESSING' | 'PAID' | 'FAILED';
/** Normalizes Paystack/Flutterwave transfer statuses. Unknown values stay PROCESSING for review. */
export function transferStatus(raw: string): TransferStatus {
  const s = raw.toLowerCase();
  if (['success', 'successful'].includes(s)) return 'PAID';
  if (['failed', 'reversed', 'rejected', 'abandoned'].includes(s)) return 'FAILED';
  return 'PROCESSING';
}
export function paymentService(c: Config) {
  return {
    enabled(provider: Provider) {
      return c.payments && !!(provider === 'paystack' ? c.paystack : c.flutterwave);
    },
    async initialize(
      provider: Provider,
      ref: string,
      amount: number,
      email: string,
      name: string,
      options: { cardOnly?: boolean } = {},
    ) {
      const d =
        provider === 'paystack'
          ? await request('https://api.paystack.co/transaction/initialize', c.paystack, {
              reference: ref,
              email,
              amount,
              currency: 'NGN',
              callback_url: c.returnUrl,
              ...(options.cardOnly ? { channels: ['card'] } : {}),
            })
          : await request('https://api.flutterwave.com/v3/payments', c.flutterwave, {
              tx_ref: ref,
              amount: amount / 100,
              currency: 'NGN',
              redirect_url: c.flutterwaveReturnUrl,
              ...(options.cardOnly ? { payment_options: 'card' } : {}),
              customer: { email, name },
              customizations: { title: 'Ahia payment' },
            });
      const url = provider === 'paystack' ? d.authorization_url : d.link;
      ensure(
        typeof url === 'string' && url.startsWith('https://'),
        502,
        'PROVIDER_ERROR',
        'Provider did not return a secure checkout URL.',
      );
      return url as string;
    },
    async verify(provider: Provider, ref: string) {
      const d =
        provider === 'paystack'
          ? await request(
              `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,
              c.paystack,
            )
          : await request(
              `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`,
              c.flutterwave,
            );
      return {
        success: d.status === (provider === 'paystack' ? 'success' : 'successful'),
        reference: provider === 'paystack' ? d.reference : d.tx_ref,
        amount: provider === 'paystack' ? Number(d.amount) : Math.round(Number(d.amount) * 100),
        currency: d.currency,
        id: String(d.id),
      };
    },
    /**
     * Refunds part or all of a verified payment to the original payment method. A rejection
     * throws PROVIDER_REJECTED; an unreachable provider throws PROVIDER_UNAVAILABLE (the
     * outcome is then unknown and must not be retried blindly).
     */
    async refund(provider: Provider, reference: string, providerId: string, amountKobo: number) {
      const d =
        provider === 'paystack'
          ? await request('https://api.paystack.co/refund', c.paystack, {
              transaction: reference,
              amount: amountKobo,
            })
          : await request(
              `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(providerId)}/refund`,
              c.flutterwave,
              { amount: amountKobo / 100 },
            );
      const id = d?.id ?? d?.refund_id;
      return {
        id: id === undefined || id === null ? null : String(id),
        status: String(d?.status ?? ''),
      };
    },
    /** Nigerian banks supported for transfers by the provider. */
    async banks(provider: Provider): Promise<{ code: string; name: string }[]> {
      const d =
        provider === 'paystack'
          ? await request('https://api.paystack.co/bank?country=nigeria&currency=NGN', c.paystack)
          : await request('https://api.flutterwave.com/v3/banks/NG', c.flutterwave);
      return (d as any[])
        .map((b) => ({ code: String(b.code), name: String(b.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    /** Confirms the account holder name with the bank before any money is sent. */
    async resolveAccount(provider: Provider, accountNumber: string, bankCode: string) {
      const d =
        provider === 'paystack'
          ? await request(
              `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
              c.paystack,
            )
          : await request('https://api.flutterwave.com/v3/accounts/resolve', c.flutterwave, {
              account_number: accountNumber,
              account_bank: bankCode,
            });
      ensure(
        typeof d?.account_name === 'string' && d.account_name.trim(),
        422,
        'ACCOUNT_NOT_RESOLVED',
        'The bank could not confirm this account number.',
      );
      return { account_name: String(d.account_name).trim() };
    },
    /** Paystack sends transfers to a saved recipient; Flutterwave uses account details directly. */
    async createRecipient(name: string, accountNumber: string, bankCode: string) {
      const d = await request('https://api.paystack.co/transferrecipient', c.paystack, {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      });
      return String(d.recipient_code);
    },
    async transfer(
      provider: Provider,
      t: {
        reference: string;
        amount: number;
        recipient?: string | null;
        bankCode: string;
        accountNumber: string;
        reason: string;
      },
    ) {
      const d =
        provider === 'paystack'
          ? await request('https://api.paystack.co/transfer', c.paystack, {
              source: 'balance',
              amount: t.amount,
              recipient: t.recipient,
              reference: t.reference,
              reason: t.reason,
              currency: 'NGN',
            })
          : await request('https://api.flutterwave.com/v3/transfers', c.flutterwave, {
              account_bank: t.bankCode,
              account_number: t.accountNumber,
              amount: t.amount / 100,
              currency: 'NGN',
              debit_currency: 'NGN',
              reference: t.reference,
              narration: t.reason,
            });
      return {
        id: transferId(provider, d),
        status: transferStatus(String(d.status)),
      };
    },
    async verifyTransfer(provider: Provider, reference: string, providerId?: string | null) {
      // A timeout can lose Flutterwave's ID even after the transfer was accepted.
      // Resolve the merchant reference first, then verify the exact transfer by ID.
      if (provider === 'flutterwave' && !providerId) {
        const matches = await request(
          `https://api.flutterwave.com/v3/transfers?reference=${encodeURIComponent(reference)}`,
          c.flutterwave,
        );
        const exact = Array.isArray(matches)
          ? matches.filter((t: any) => t.reference === reference)
          : [];
        ensure(
          exact.length === 1 && exact[0].id != null,
          502,
          'TRANSFER_NOT_FOUND',
          'Transfer could not be uniquely located; funds remain held for review.',
        );
        providerId = String(exact[0].id);
      }
      const d =
        provider === 'paystack'
          ? await request(
              `https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`,
              c.paystack,
            )
          : await request(
              `https://api.flutterwave.com/v3/transfers/${encodeURIComponent(providerId!)}`,
              c.flutterwave,
            );
      return {
        id: transferId(provider, d),
        reference: d.reference,
        currency: d.currency,
        status: transferStatus(String(d.status)),
        amount: provider === 'paystack' ? Number(d.amount) : Math.round(Number(d.amount) * 100),
      };
    },
    signature(provider: Provider, raw: Buffer, signature: string) {
      const secret = provider === 'paystack' ? c.paystack : c.flutterwaveWebhook;
      if (!secret || !signature) return false;
      if (provider === 'flutterwave' && c.flutterwaveWebhookMode === 'legacy') {
        const a = Buffer.from(secret),
          b = Buffer.from(signature);
        return a.length === b.length && timingSafeEqual(a, b);
      }
      const expected = createHmac(provider === 'paystack' ? 'sha512' : 'sha256', secret)
        .update(raw)
        .digest(provider === 'paystack' ? 'hex' : 'base64');
      const a = Buffer.from(expected),
        b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
