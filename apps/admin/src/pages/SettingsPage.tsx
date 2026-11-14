import React, { useState } from 'react';
import {
  Sprout,
  Store,
  ShoppingBag,
  Package,
  Settings,
  ScrollText,
  Wallet,
  ArrowUpRight,
  Search,
  Check,
  ChevronRight,
  Clock,
  X,
  ShieldCheck,
} from 'lucide-react';
import {
  money,
  statusLabel,
  type Seller,
  type Booking,
  type Listing,
  type Settings as MarketSettings,
  type OrderEvent,
} from '@farmers-market/shared';
import { api } from '../api';
import { Badge, Stat, Empty, Toolbar, BookingTable } from '../ui';
import { useAdmin } from '../AdminContext';
import { VehicleTypesCard } from './DeliveryPages';
export default function SettingsPage({ settings }: { settings: MarketSettings }) {
  const { busy, action, go, openTimeline, openReview } = useAdmin();
  const s = settings as any;
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('ALL');
  return (
    <div className="settings-grid">
      <VehicleTypesCard />
      <section className="card settings-card">
        <h2>Marketplace rules</h2>
        <p>Changes apply to new reservations and bookings. Existing booking fees stay fixed.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(
              () =>
                api('/admin/settings', 'PUT', {
                  reservation_hours: Number(f.get('hours')),
                  commission_bps: Math.round(Number(f.get('commission')) * 100),
                  payout_min_kobo: Math.round(Number(f.get('payoutMin')) * 100),
                  payout_fee_kobo: Math.round(Number(f.get('payoutFee')) * 100),
                  promotion_daily_kobo: Math.round(Number(f.get('promoDaily')) * 100),
                  delivery_commission_bps: Math.round(Number(f.get('deliveryCommission')) * 100),
                  delivery_radius_km: Number(f.get('deliveryRadius')),
                  pay_on_delivery_enabled: f.get('pod') === 'on',
                }),
              'Marketplace rules saved.',
            );
          }}
        >
          <label>
            Reservation duration (hours)
            <input
              key={`h${settings.reservation_hours}`}
              name="hours"
              type="number"
              min="1"
              max="720"
              defaultValue={settings.reservation_hours}
              required
            />
            <small>168 hours = one week, starting when the seller accepts.</small>
          </label>
          <label>
            Platform commission (%)
            <input
              key={`c${settings.commission_bps}`}
              name="commission"
              type="number"
              min="0"
              max="30"
              step="0.01"
              defaultValue={settings.commission_bps / 100}
              required
            />
            <small>Deducted from the seller’s proceeds after confirmed collection.</small>
          </label>
          <label>
            Minimum seller payout (₦)
            <input
              key={`pm${settings.payout_min_kobo}`}
              name="payoutMin"
              type="number"
              min="1"
              step="0.01"
              defaultValue={(settings.payout_min_kobo ?? 100000) / 100}
              required
            />
          </label>
          <label>
            Payout transfer fee (₦)
            <input
              key={`pf${settings.payout_fee_kobo}`}
              name="payoutFee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={(settings.payout_fee_kobo ?? 5000) / 100}
              required
            />
            <small>Deducted from each withdrawal to cover the provider’s transfer charge.</small>
          </label>
          <label>
            Sponsored listing price per day (₦)
            <input
              key={`sp${s.promotion_daily_kobo}`}
              name="promoDaily"
              type="number"
              min="0"
              step="0.01"
              defaultValue={(s.promotion_daily_kobo ?? 50000) / 100}
              required
            />
          </label>
          <label>
            Delivery commission (% of fare)
            <input
              key={`dc${s.delivery_commission_bps}`}
              name="deliveryCommission"
              type="number"
              min="0"
              max="50"
              step="0.01"
              defaultValue={(s.delivery_commission_bps ?? 1000) / 100}
              required
            />
          </label>
          <label>
            Driver job radius (km)
            <input
              key={`dr${s.delivery_radius_km}`}
              name="deliveryRadius"
              type="number"
              min="1"
              max="200"
              defaultValue={s.delivery_radius_km ?? 15}
              required
            />
          </label>
          <label className="inline">
            <input
              key={`pod${s.pay_on_delivery_enabled}`}
              name="pod"
              type="checkbox"
              defaultChecked={!!s.pay_on_delivery_enabled}
            />{' '}
            Allow digital Pay on Delivery
            <small>
              Buyers pay in the app at the door; cash is never accepted. Enable only after legal and
              provider sign-off.
            </small>
          </label>
          <button className="primary" disabled={busy}>
            Save rules <Check size={16} />
          </button>
        </form>
      </section>
      <section className="card settings-card">
        <h2>Stock & payments</h2>
        <dl>
          <dt>Stock confirmation</dt>
          <dd>Immediate</dd>
          <dt>Payment environment</dt>
          <dd>{settings.payment_mode}</dd>
          <dt>Configured providers</dt>
          <dd>{settings.providers.join(', ') || 'None configured'}</dd>
          <dt>Supported integrations</dt>
          <dd>Paystack · Flutterwave</dd>
        </dl>
        <p className="fine">
          Provider credentials and live payment activation are configured on the API server.
        </p>
      </section>
    </div>
  );
}
