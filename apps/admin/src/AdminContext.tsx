import type { Booking, Seller } from '@ahia/shared';
import { createContext, useContext } from 'react';
export type Page =
  | 'Regional fares'
  | 'Delivery incidents'
  | 'Analytics'
  | 'Returns'
  | 'Appeals'
  | 'Parcels'
  | 'Regions'
  | 'Catalogue'
  | 'Policies'
  | 'Overview'
  | 'Sellers'
  | 'Bookings'
  | 'Listings'
  | 'Ledger'
  | 'Audit log'
  | 'Settings'
  | 'Users'
  | 'Reports'
  | 'Email queue'
  | 'Markets'
  | 'Disputes'
  | 'Reconciliation'
  | 'Payouts'
  | 'Refunds'
  | 'Promotions'
  | 'Drivers'
  | 'Shopping'
  | 'Local Status'
  | 'Status boosts'
  | 'Planner'
  | 'Allergen reports'
  | 'Verifications'
  | 'Revenue'
  | 'Advertising'
  | 'Delivery partners'
  | 'Planner content'
  | 'Growth'
  | 'Deliveries'
  | 'Staff';
export interface AdminState {
  user: any;
  busy: boolean;
  action: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  setError: (message: string) => void;
  go: (page: Page) => void;
  openTimeline: (booking: Booking) => void;
  openReview: (seller: Seller) => void;
}
export const AdminContext = createContext<AdminState | null>(null);
export function useAdmin() {
  const v = useContext(AdminContext);
  if (!v) throw new Error('useAdmin must be used inside AdminContext.Provider');
  return v;
}
