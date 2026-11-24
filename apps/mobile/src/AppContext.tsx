import type { Booking, Listing, Seller, Settings } from '@ahia/shared';
import { createContext, useContext } from 'react';

export type Tab =
  | 'Market'
  | 'Categories'
  | 'Bookings'
  | 'Sell'
  | 'Riders'
  | 'Drive'
  | 'Wallet'
  | 'Inbox'
  | 'Account'
  | 'Cart'
  | 'Planner'
  | 'Nearby'
  | 'Business';

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
  openListing: (
    listing: Listing,
    options?: {
      variantId?: string;
      quantity?: number;
      attributionToken?: string;
      /** Ordering from a seller's quote on the buyer's request. */
      quote?: { id: string; price_kobo: number; business_name: string };
    },
  ) => void;
  /** Opens a seller's shop page (their listings, reviews and share link). */
  openSeller: (sellerId: string) => void;
  setTab: (tab: Tab) => void;
  /** Items in the cart, for badges. */
  cartCount: number;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext.Provider');
  return value;
}
