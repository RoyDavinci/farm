import * as Crypto from 'expo-crypto';
import { api, ApiError } from './api';

export interface FundingRow {
  id: string;
  provider: string;
  amount_kobo: number;
  status: 'INITIALIZING' | 'PENDING' | 'UNCERTAIN' | 'FAILED' | 'EXPIRED' | 'SUCCESSFUL' | string;
  checkout_url: string | null;
  created_at: string;
}

/**
 * Starts a hosted checkout. One key is used for the whole attempt, so retries (including after a
 * dropped connection) return the same checkout instead of creating a second one. While the server
 * is still preparing it (FUNDING_IN_PROGRESS) we wait and ask again.
 */
export async function startCheckout(provider: string, amount_kobo: number) {
  const idempotencyKey = Crypto.randomUUID();
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<{ checkout_url: string; reference: string }>(
        '/wallet/fund',
        'POST',
        { provider, amount_kobo },
        { idempotencyKey },
      );
    } catch (e) {
      const retryable =
        (e instanceof ApiError && e.code === 'FUNDING_IN_PROGRESS') ||
        (!(e instanceof ApiError) && String((e as Error).message).includes('reach'));
      if (!retryable || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/** What each top-up state means to the buyer, and what they can do about it. */
export function describeFunding(f: FundingRow) {
  switch (f.status) {
    case 'INITIALIZING':
      return {
        label: 'Preparing checkout…',
        detail: 'This usually takes a few seconds.',
        verify: false,
        reopen: false,
      };
    case 'PENDING':
      return {
        label: 'Waiting for payment',
        detail:
          'Finish paying in the provider’s checkout. We confirm it automatically, or tap Verify.',
        verify: true,
        reopen: true,
      };
    case 'UNCERTAIN':
      return {
        label: 'Checkout was interrupted',
        detail:
          'We couldn’t confirm the checkout opened. If you paid, tap Verify — you’re never charged twice. Otherwise you can start a new top-up.',
        verify: true,
        reopen: false,
      };
    case 'FAILED':
      return {
        label: 'Checkout couldn’t start',
        detail: 'Nothing was charged. Try again.',
        verify: false,
        reopen: false,
      };
    case 'EXPIRED':
      return {
        label: 'Checkout expired',
        detail: 'If money left your account for this top-up, tap Verify or contact support.',
        verify: true,
        reopen: false,
      };
    case 'SUCCESSFUL':
      return { label: 'Added to wallet', detail: '', verify: false, reopen: false };
    default:
      return { label: f.status, detail: '', verify: false, reopen: false };
  }
}
