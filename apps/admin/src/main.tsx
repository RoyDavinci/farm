import type { ApiPath } from '@farmers-market/shared';
import {
  statusLabel,
  type Booking,
  type Listing,
  type Settings as MarketSettings,
  type OrderEvent,
  type Seller,
} from '@farmers-market/shared';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  Store,
  Wallet,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminContext, type AdminState, type Page } from './AdminContext';
import { onSessionExpired, request, saveToken } from './api';
import AuthPanel from './AuthPanel';
import CommercePanel from './CommercePanel';
import OperationsPanel from './OperationsPanel';
import AuditPage from './pages/AuditPage';
import BookingsPage from './pages/BookingsPage';
import { DeliveriesPage, DriversPage } from './pages/DeliveryPages';
import LedgerPage from './pages/LedgerPage';
import ListingsPage from './pages/ListingsPage';
import { SellerReviewModal, TimelineModal } from './pages/Modals';
import OverviewPage from './pages/OverviewPage';
import PayoutsPage from './pages/PayoutsPage';
import PromotionsPage from './pages/PromotionsPage';
import SellersPage from './pages/SellersPage';
import SettingsPage from './pages/SettingsPage';
import StaffPage from './pages/StaffPage';
import './styles.css';

/** Contract paths that the console loads with GET and no parameters. */
type GetPath = Extract<
  ApiPath,
  | '/admin/overview'
  | '/admin/sellers'
  | '/admin/bookings'
  | '/admin/listings'
  | '/admin/audit'
  | '/admin/ledger'
>;
// Maps each console page to the API area its staff role must have.
const pageArea: Record<Page, string> = {
  Overview: 'overview',
  Sellers: 'sellers',
  Bookings: 'bookings',
  Listings: 'listings',
  Ledger: 'ledger',
  'Audit log': 'audit',
  Settings: 'settings',
  Users: 'users',
  Reports: 'reports',
  'Email queue': 'email-queue',
  Markets: 'markets',
  Disputes: 'disputes',
  Reconciliation: 'reconciliation',
  Payouts: 'payouts',
  Promotions: 'promotions',
  Drivers: 'drivers',
  Deliveries: 'deliveries',
  Staff: 'staff',
};
const navigation = [
  ['Overview', LayoutDashboard],
  ['Sellers', Store],
  ['Bookings', ShoppingBag],
  ['Listings', Package],
  ['Ledger', Wallet],
  ['Audit log', ScrollText],
  ['Settings', Settings],
  ['Users', ShieldCheck],
  ['Reports', ScrollText],
  ['Email queue', Clock],
  ['Markets', Store],
  ['Disputes', ShieldCheck],
  ['Reconciliation', Wallet],
  ['Payouts', Wallet],
  ['Promotions', ArrowUpRight],
  ['Drivers', ShieldCheck],
  ['Deliveries', Package],
  ['Staff', ShieldCheck],
] as const;
function App() {
  const [user, setUser] = useState<any>(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState<Page>('Overview'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [menu, setMenu] = useState(false);
  const [overview, setOverview] = useState<any>(null),
    [sellers, setSellers] = useState<(Seller & { name: string; email: string })[]>([]),
    [bookings, setBookings] = useState<Booking[]>([]),
    [listings, setListings] = useState<Listing[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [ledger, setLedger] = useState<any[]>([]),
    [settings, setSettings] = useState<MarketSettings | null>(null),
    [search, setSearch] = useState('');
  const [staffAreas, setStaffAreas] = useState<string[] | null>(null);
  const [review, setReview] = useState<Seller | null>(null),
    [timeline, setTimeline] = useState<{
      booking: Booking;
      events: OrderEvent[];
    } | null>(null);
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        setError('');
      }),
    [],
  );
  useEffect(() => {
    request('get', '/me')
      .then((d) => {
        if (!d.user.admin) {
          saveToken('');
          return;
        }
        setUser(d.user);
      })
      .catch(() => saveToken(''))
      .finally(() => setChecking(false));
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Staff roles see only some areas; load what this role may read and leave the rest empty.
      const me = await request('get', '/me');
      const areas: string[] = me.staff_areas || [];
      setStaffAreas(areas);
      const get = (area: string, path: GetPath, empty: any) =>
        areas.includes(area) ? request('get', path) : Promise.resolve(empty);
      const [o, s, b, l, a, e, c] = await Promise.all([
        get('overview', '/admin/overview', null),
        get('sellers', '/admin/sellers', []),
        get('bookings', '/admin/bookings', []),
        get('listings', '/admin/listings', []),
        get('audit', '/admin/audit', []),
        get('ledger', '/admin/ledger', []),
        request('get', '/settings'),
      ]);
      setOverview(o);
      setSellers(s);
      setBookings(b);
      setListings(l);
      setAudit(a);
      setLedger(e);
      setSettings(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [user, load]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (checking) return <div className="initial">Opening Farmers Market…</div>;
  if (!user)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <Sprout size={32} />
            farmers market<span>OPERATIONS</span>
          </div>
          <div>
            <span className="eyebrow">GROWING LOCAL CONNECTIONS</span>
            <h1>
              Good food.
              <br />
              Closer communities.
            </h1>
            <p>
              A little more visibility. A lot more possibility.
              <br />
              Your market’s everyday operations, in one place.
            </p>
          </div>
          <small>Farmers Market · Nigeria</small>
        </div>
        <AuthPanel onSignedIn={setUser} />
      </div>
    );
  const pending = sellers.filter((s) => s.status === 'PENDING');
  function go(p: Page) {
    setPage(p);
    setMenu(false);
    setNotice('');
  }
  const ctx: AdminState = {
    user,
    busy,
    action,
    setError,
    go,
    openTimeline: (b) =>
      void (
        request('get', '/bookings/{id}/events', { params: { id: b.id } }) as Promise<OrderEvent[]>
      )
        .then((events) => setTimeline({ booking: b, events }))
        .catch((e) => setError(e.message)),
    openReview: setReview,
  };
  return (
    <AdminContext.Provider value={ctx}>
      <div className="shell">
        <aside className={menu ? 'sidebar open' : 'sidebar'}>
          <div className="brand">
            <span className="brand-icon">
              <Sprout />
            </span>
            <div>
              farmers market<small>OPERATIONS CONSOLE</small>
            </div>
          </div>
          <div className="workspace">
            <span className="market-avatar">FM</span>
            <div>
              Nigeria marketplace
              <small>
                <i /> Market operations
              </small>
            </div>
          </div>
          <span className="nav-label">WORKSPACE</span>
          <nav>
            {navigation
              .filter(([name]) => !staffAreas || staffAreas.includes(pageArea[name]))
              .map(([name, Icon]) => (
                <button
                  key={name}
                  className={page === name ? 'nav active' : 'nav'}
                  onClick={() => go(name)}
                >
                  <Icon size={19} />
                  {name}
                  {name === 'Sellers' && pending.length > 0 && (
                    <span className="count">{pending.length}</span>
                  )}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="pilot">
              <Sprout size={20} />
              <b>Built for local growth</b>
              <p>One market. Many possibilities.</p>
            </div>
            <button
              className="profile"
              onClick={() =>
                void action(async () => {
                  await request('post', '/auth/logout');
                  saveToken('');
                  setUser(null);
                }, '')
              }
            >
              <span className="avatar">{user.name.slice(0, 1)}</span>
              <span>
                {user.name}
                <small>{statusLabel(user.staff_role || 'administrator')}</small>
              </span>
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="workspace-main">
          <header>
            <div className="breadcrumbs">
              <button
                className="icon mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMenu(!menu)}
              >
                <Menu />
              </button>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <b>{page}</b>
            </div>
            <div className="header-right">
              <span className="live">
                <i /> API connected
              </span>
              <span className="avatar small">{user.name.slice(0, 1)}</span>
            </div>
          </header>
          <main className="content">
            <div className="page-title">
              <div>
                <span className="eyebrow">FARMERS MARKET / {page.toUpperCase()}</span>
                <h1>{page === 'Overview' ? 'A fresh look at your market.' : page}</h1>
                <p>
                  {
                    {
                      Overview: 'The people, produce and pickups keeping your marketplace moving.',
                      Sellers: 'Meet your growers. Verify their details. Help them get started.',
                      Bookings: 'Follow every request from reservation to confirmed pickup.',
                      Listings: 'Keep the marketplace fresh, accurate and ready to shop.',
                      Ledger: 'An auditable record of wallet funds, held payments and earnings.',
                      'Audit log':
                        'Every sensitive operation, with a reason and a responsible person.',
                      Settings: 'Clear rules for every seller and every booking.',
                      Users: 'Manage marketplace accounts and access.',
                      Reports: 'Review buyer and seller reports with an audit trail.',
                      'Email queue': 'Monitor notification delivery and retry failures.',
                      Markets: 'Manage the city and market directory.',
                      Disputes: 'Review evidence, returns and wallet refunds.',
                      Reconciliation: 'Verify provider funding and review exceptions.',
                      Payouts: 'Review seller withdrawals and send bank transfers.',
                      Promotions: 'Sponsored listings, clearly labelled for buyers.',
                      Drivers: 'Verify independent drivers before they take deliveries.',
                      Deliveries: 'Follow every delivery from request to PIN confirmation.',
                      Staff: 'Choose who can use each part of the console.',
                    }[page]
                  }
                </p>
              </div>
              <button className="secondary" disabled={loading} onClick={() => void load()}>
                <RefreshCw size={16} className={loading ? 'spin' : ''} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="alert success" role="status">
                <Check size={16} />
                {notice}
              </div>
            )}
            {settings?.payment_mode === 'demo' && (
              <div className="demo-banner">
                <span>DEVELOPMENT</span>Wallet funds are simulated. No real money is collected or
                paid out.
              </div>
            )}
            {page === 'Overview' && (
              <OverviewPage
                overview={overview}
                sellers={sellers}
                bookings={bookings}
                settings={settings}
              />
            )}
            {page === 'Sellers' && <SellersPage sellers={sellers} />}
            {page === 'Bookings' && <BookingsPage bookings={bookings} />}
            {page === 'Listings' && <ListingsPage listings={listings} />}
            {page === 'Settings' && settings && <SettingsPage settings={settings} />}
            {page === 'Audit log' && <AuditPage audit={audit} />}
            {page === 'Ledger' && <LedgerPage ledger={ledger} />}
            {page === 'Payouts' && <PayoutsPage />}
            {page === 'Promotions' && <PromotionsPage />}
            {page === 'Staff' && <StaffPage />}
            {page === 'Drivers' && <DriversPage />}
            {page === 'Deliveries' && <DeliveriesPage />}
            {(page === 'Users' || page === 'Reports' || page === 'Email queue') && (
              <OperationsPanel page={page} />
            )}
            {(page === 'Markets' || page === 'Disputes' || page === 'Reconciliation') && (
              <CommercePanel page={page} />
            )}
            <footer>
              Farmers Market <span>Made for the people who keep our markets growing.</span>
            </footer>
          </main>
        </div>
        {review && (
          <SellerReviewModal seller={review} error={error} onClose={() => setReview(null)} />
        )}
        {timeline && <TimelineModal timeline={timeline} onClose={() => setTimeline(null)} />}
      </div>
    </AdminContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
