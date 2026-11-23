import RegionsPage from './pages/RegionsPage';
import ParcelsPage from './pages/ParcelsPage';
import ReturnsPage from './pages/ReturnsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DeliveryOperationsPage from './pages/DeliveryOperationsPage';
import MarketMappingPanel from './pages/MarketMappingPanel';
import CataloguePage from './pages/CataloguePage';
import PoliciesPage from './pages/PoliciesPage';
import StatusBoostsPage from './pages/StatusBoostsPage';
import LocalStatusPage from './pages/LocalStatusPage';
import ShoppingPage from './pages/ShoppingPage';
import type { ApiPath } from '@ahia/shared';
import {
  statusLabel,
  type Booking,
  type Listing,
  type Settings as MarketSettings,
  type OrderEvent,
  type Seller,
} from '@ahia/shared';
import {
  Sparkles,
  BookOpenText,
  Handshake,
  Newspaper,
  ChartColumn,
  BadgeCheck,
  ClipboardList,
  ShieldAlert,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Bike,
  Boxes,
  ChartLine,
  Check,
  CircleDot,
  FileText,
  Flag,
  Gavel,
  Globe,
  Mail,
  MapPinned,
  Megaphone,
  Rocket,
  RotateCcw,
  Route,
  Scale,
  ShoppingCart,
  Tags,
  TriangleAlert,
  Truck,
  Undo2,
  Users,
  type LucideIcon,
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
import RiskPage from './pages/RiskPage';
import RefundsPage from './pages/RefundsPage';
import { AllergenReportsPage, PlannerUsagePage } from './pages/PlannerPages';
import {
  AdvertisingPage,
  DeliveryPartnersPage,
  RevenuePage,
  VerificationsPage,
} from './pages/BusinessPages';
import { GrowthPage, PlannerContentPage } from './pages/GrowthPages';
import PromotionsPage from './pages/PromotionsPage';
import SellersPage from './pages/SellersPage';
import SettingsPage from './pages/SettingsPage';
import StaffPage from './pages/StaffPage';
import './styles.css';
import './design.css';

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
  'Regional fares': 'tariffs',
  'Delivery incidents': 'incidents',
  Analytics: 'analytics',
  Returns: 'returns',
  Appeals: 'appeals',
  Parcels: 'parcels',
  Regions: 'regions',
  Catalogue: 'catalogue',
  Policies: 'policies',
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
  Risk: 'risk',
  Refunds: 'refunds',
  Planner: 'planner',
  'Allergen reports': 'allergen-reports',
  Verifications: 'verifications',
  Revenue: 'revenue',
  Advertising: 'ads',
  'Delivery partners': 'delivery-partners',
  'Planner content': 'planner',
  Growth: 'subscriptions',
  Promotions: 'promotions',
  Drivers: 'drivers',
  Deliveries: 'deliveries',
  Shopping: 'shopping',
  'Local Status': 'local-status',
  'Status boosts': 'status-boosts',
  Staff: 'staff',
};
// Pages that belong to a switchable feature (see the API's config/features.ts).
const pageFeature: Partial<Record<Page, keyof NonNullable<MarketSettings['features']>>> = {
  Parcels: 'parcels',
  Shopping: 'shopping',
  'Local Status': 'local_status',
  'Status boosts': 'local_status',
  Promotions: 'promotions',
  Advertising: 'promotions',
  Markets: 'market_maps',
};
// Sidebar sections, in order. Overview first; each page has a distinct icon.
const navGroups: { label: string; items: (readonly [Page, LucideIcon])[] }[] = [
  { label: '', items: [['Overview', LayoutDashboard]] },
  {
    label: 'Marketplace',
    items: [
      ['Sellers', Store],
      ['Listings', Package],
      ['Bookings', ShoppingBag],
      ['Catalogue', Tags],
      ['Markets', MapPinned],
      ['Regions', Globe],
      ['Policies', FileText],
    ],
  },
  {
    label: 'Delivery',
    items: [
      ['Drivers', Bike],
      ['Deliveries', Truck],
      ['Delivery partners', Handshake],
      ['Parcels', Boxes],
      ['Shopping', ShoppingCart],
      ['Returns', Undo2],
      ['Appeals', Scale],
      ['Regional fares', Route],
      ['Delivery incidents', TriangleAlert],
    ],
  },
  {
    label: 'Money',
    items: [
      ['Revenue', ChartColumn],
      ['Growth', Sparkles],
      ['Payouts', Banknote],
      ['Refunds', RotateCcw],
      ['Reconciliation', ArrowLeftRight],
      ['Ledger', Wallet],
      ['Promotions', Megaphone],
      ['Advertising', Newspaper],
    ],
  },
  {
    label: 'Trust & community',
    items: [
      ['Risk', ShieldAlert],
      ['Users', Users],
      ['Verifications', BadgeCheck],
      ['Reports', Flag],
      ['Allergen reports', ShieldAlert],
      ['Disputes', Gavel],
      ['Local Status', CircleDot],
      ['Status boosts', Rocket],
    ],
  },
  {
    label: 'Insights & admin',
    items: [
      ['Analytics', ChartLine],
      ['Planner', ClipboardList],
      ['Planner content', BookOpenText],
      ['Audit log', ScrollText],
      ['Email queue', Mail],
      ['Staff', ShieldCheck],
      ['Settings', Settings],
    ],
  },
];
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
  if (checking) return <div className="initial">Opening Ahia…</div>;
  if (!user)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <img className="brand-logo large" src="/apple-touch-icon.png" alt="" />
            ahia<span>OPERATIONS</span>
          </div>
          <div>
            <span className="eyebrow">GROWING LOCAL CONNECTIONS</span>
            <h1>
              Great goods.
              <br />
              Closer communities.
            </h1>
            <p>
              A little more visibility. A lot more possibility.
              <br />
              Your market’s everyday operations, in one place.
            </p>
          </div>
          <small>Ahia · Nigeria</small>
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
            <img className="brand-logo" src="/apple-touch-icon.png" alt="" />
            <div>
              ahia<small>OPERATIONS CONSOLE</small>
            </div>
          </div>
          <div className="workspace">
            <span className="market-avatar">NG</span>
            <div>
              Nigeria marketplace
              <small>
                <i /> Market operations
              </small>
            </div>
          </div>
          <nav>
            {navGroups.map((group) => {
              const items = group.items
                .filter(([name]) => !staffAreas || staffAreas.includes(pageArea[name]))
                .filter(([name]) => {
                  const feature = pageFeature[name];
                  if (feature) return settings?.features?.[feature] ?? true;
                  // Card refunds only exist when the wallet feature is off.
                  return name !== 'Refunds' || settings?.features?.wallet === false;
                });
              if (!items.length) return null;
              return (
                <div className="nav-group" key={group.label || 'home'}>
                  {group.label && <span className="nav-label">{group.label}</span>}
                  {items.map(([name, Icon]) => (
                    <button
                      key={name}
                      className={page === name ? 'nav active' : 'nav'}
                      aria-current={page === name ? 'page' : undefined}
                      onClick={() => go(name)}
                    >
                      <Icon size={18} strokeWidth={1.9} />
                      <span>{name}</span>
                      {name === 'Sellers' && pending.length > 0 && (
                        <span className="count">{pending.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <div className="pilot">
              <ShoppingBag size={20} />
              <b>A world of shopping.</b>
              <p>Buying, selling and delivery near you.</p>
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
                <span className="eyebrow">AHIA / {page.toUpperCase()}</span>
                <h1>{page === 'Overview' ? 'A fresh look at your market.' : page}</h1>
                <p>
                  {
                    {
                      Overview:
                        'The people, products and deliveries keeping your marketplace moving.',
                      Sellers: 'Meet your sellers. Verify their details. Help them get started.',
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
                      Risk: 'Fraud signals to check: linked accounts, odd money patterns and identity problems.',
                      Refunds: 'Refunds sent back to buyers’ cards, and any that need a check.',
                      Planner: 'How customers plan: types, products matched, orders and budgets.',
                      Verifications: 'Check businesses before they get the Verified badge.',
                      Revenue: 'Income by stream, revenue switches and promotion prices.',
                      Advertising: 'Adverts from local businesses and featured shops.',
                      'Delivery partners': 'Logistics companies, their riders and agreed rates.',
                      'Planner content': 'Plan types, recipes and ingredients the planner uses.',
                      Growth: 'Subscriptions, membership, market research and integrations.',
                      'Allergen reports':
                        'Missing or wrong allergen information reported by buyers.',
                      Promotions: 'Sponsored listings, clearly labelled for buyers.',
                      'Status boosts': 'Review paid status campaigns and targeting.',
                      'Regional fares':
                        'Set area-specific vehicle availability and delivery prices.',
                      'Delivery incidents': 'Review delivery and safety reports.',
                      Analytics: 'Understand marketplace discovery, fulfilment and retention.',
                      Returns: 'Arrange reviewed return transport and compensation.',
                      Appeals: 'Review challenges to dispute outcomes.',
                      Parcels: 'Monitor independent parcel delivery and support pauses.',
                      Regions: 'Plan operating countries, currencies and pilot cities.',
                      Catalogue: 'Manage product categories and selling rules.',
                      Policies: 'Review operating policy proposals.',
                      'Local Status':
                        'Review temporary local product updates and reported content.',
                      Drivers: 'Verify independent drivers before they take deliveries.',
                      Deliveries: 'Follow every delivery from request to PIN confirmation.',
                      Shopping:
                        'Buyer budgets, rider shopping requests, advances and delivery confirmation.',
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
            {page === 'Risk' && <RiskPage />}
            {page === 'Refunds' && <RefundsPage />}
            {page === 'Planner' && <PlannerUsagePage />}
            {page === 'Verifications' && <VerificationsPage />}
            {page === 'Revenue' && <RevenuePage />}
            {page === 'Advertising' && <AdvertisingPage />}
            {page === 'Delivery partners' && <DeliveryPartnersPage />}
            {page === 'Planner content' && <PlannerContentPage />}
            {page === 'Growth' && <GrowthPage />}
            {page === 'Allergen reports' && <AllergenReportsPage />}
            {page === 'Promotions' && <PromotionsPage />}
            {page === 'Staff' && <StaffPage />}
            {page === 'Catalogue' && <CataloguePage />}
            {page === 'Regions' && <RegionsPage />}
            {page === 'Parcels' && <ParcelsPage />}
            {page === 'Returns' && <ReturnsPage />}
            {page === 'Appeals' && <ReturnsPage appeals />}
            {page === 'Analytics' && <AnalyticsPage />}
            {page === 'Regional fares' && <DeliveryOperationsPage mode="tariffs" />}
            {page === 'Delivery incidents' && <DeliveryOperationsPage mode="incidents" />}
            {page === 'Policies' && <PoliciesPage />}
            {page === 'Markets' && <MarketMappingPanel />}
            {page === 'Drivers' && <DriversPage />}
            {page === 'Deliveries' && <DeliveriesPage />}
            {page === 'Shopping' && <ShoppingPage />}
            {page === 'Local Status' && <LocalStatusPage />}
            {page === 'Status boosts' && <StatusBoostsPage />}
            {(page === 'Users' || page === 'Reports' || page === 'Email queue') && (
              <OperationsPanel key={page} page={page} />
            )}
            {(page === 'Markets' || page === 'Disputes' || page === 'Reconciliation') && (
              <CommercePanel key={page} page={page} />
            )}
            <footer>
              Ahia <span>Made for the people who keep our markets growing.</span>
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
