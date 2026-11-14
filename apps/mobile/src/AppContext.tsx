import type { Booking, Listing, Seller, Settings } from '@farmers-market/shared';
import { createContext, useContext } from 'react';

export type Tab = 'Market' | 'Bookings' | 'Sell' | 'Drive' | 'Wallet' | 'Inbox' | 'Account';

export interface AppState {
  me: any;
  seller: Seller | null;
  settings: Settings | null;
  busy: boolean;
  /** Runs an action with shared busy/error/notice handling, then refreshes app data. */
  run: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  refresh: () => Promise<void>;
  openHistory: (booking: Booking) => void;
  openConversation: (conversationId: string) => void;
  openListing: (listing: Listing, options?: { variantId?: string; quantity?: number }) => void;
  /** Opens a seller's shop page (their listings, reviews and share link). */
  openSeller: (sellerId: string) => void;
  setTab: (tab: Tab) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext.Provider');
  return value;
}
