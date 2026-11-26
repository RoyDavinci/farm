import { featureOn } from './src/features';
import BottomNavigation from './src/BottomNavigation';
import RidersScreen from './src/screens/RidersScreen';
import {
  type Booking,
  type Listing,
  type OrderEvent,
  type Seller,
  type Settings,
  money,
} from '@ahia/shared';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  actAsSeller,
  actingAs,
  liveUpdates,
  onSessionExpired,
  onTeamAccessLost,
  restoreToken,
  saveToken,
} from './src/api';
import { AppContext, type AppState, type Tab } from './src/AppContext';
import AuthScreen from './src/AuthScreen';
import CommunityScreen from './src/CommunityScreen';
import DiscoveryPanel from './src/DiscoveryPanel';
import CategoriesScreen from './src/CategoriesScreen';
import CartScreen from './src/screens/CartScreen';
import PlannerScreen from './src/screens/PlannerScreen';
import NearbySellersScreen from './src/screens/NearbySellersScreen';
import BusinessHubScreen from './src/screens/BusinessHubScreen';
import { LanguageProvider, useI18n } from './src/i18n';
import { onConnectivity } from './src/offline';
import { onNotificationTap, registerForPush } from './src/push';
import { request } from './src/request';
import AccountScreen from './src/screens/AccountScreen';
import { BookingsScreen, HistoryView } from './src/screens/BookingsScreen';
import DriveScreen from './src/screens/DriveScreen';
import ListingDetail from './src/screens/ListingDetail';
import ListingEditor from './src/screens/ListingEditor';
import SellerShop from './src/screens/SellerShop';
import SellScreen from './src/screens/SellScreen';
import WalletScreen, { type WalletData } from './src/screens/WalletScreen';
import { sellerFromUrl } from './src/share';
import { Alert, Brand, Button, FadeIn, s } from './src/ui';
import { useBalanceHidden } from './src/balanceVisibility';

// Web: keyboard focus rings in the brand green instead of the browser's default blue.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const focus = document.createElement('style');
  focus.textContent =
    // Fields: a soft light-green ring that follows the field's rounded corners.
    'input:focus,textarea:focus{outline:none!important;box-shadow:0 0 0 3px #d3eedf;border-color:#8fd0ac!important}' +
    // Pill fields (search): the ring goes round the whole pill, not the text area inside it.
    '[data-focusring="pill"]:focus-within{box-shadow:0 0 0 3px #d3eedf;border-color:#8fd0ac!important}' +
    '[data-focusring="pill"] input:focus{box-shadow:none;border-color:transparent!important}' +
    '[role="button"]:focus-visible{outline:2px solid #8fd0ac;outline-offset:2px}';
  document.head.appendChild(focus);
}

/** Header balance: full naira under ₦100k, then ₦125k / ₦1.2m so it fits next to the icons. */
/** Where a push notification without a stored link leads (sent before links existed). */
function linkForKind(kind: string) {
  const byKind: Record<string, string> = {
    planner: 'planner',
    plan: 'planner',
    message: 'messages',
    shopping: 'riders',
    payment: 'wallet',
    payout: 'wallet',
    group_buy: 'home:groups',
    request: 'account:requests',
  };
  return byKind[kind] || null;
}
function shortMoney(kobo: number) {
  const n = kobo / 100;
  if (n >= 1_000_000)
    return `₦${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (n >= 100_000) return `₦${Math.floor(n / 1000)}k`;
  return money(kobo).replace(/\.00$/, '');
}

export default function App() {
  return (
    <LanguageProvider>
      <Main />
    </LanguageProvider>
  );
}

function Main() {
  const scrollY = useRef(0);
  const [balanceHidden] = useBalanceHidden();
  const scrollRef = useRef<{ scrollTo: (o: { y: number; animated: boolean }) => void } | null>(
    null,
  );
  const { width } = useWindowDimensions();
  const { t } = useI18n();
  const [me, setMe] = useState<any>(null),
    [seller, setSeller] = useState<Seller | null>(null),
    [initializing, setInitializing] = useState(true),
    [tab, setTab] = useState<Tab>('Market'),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    // An action that failed (a button press): shown as a popup so it isn't missed off-screen.
    [popup, setPopup] = useState(''),
    [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null),
    [mine, setMine] = useState<Listing[]>([]),
    [bookings, setBookings] = useState<Booking[]>([]),
    [wallet, setWallet] = useState<WalletData>({
      balance_kobo: 0,
      seller_payable_kobo: 0,
      entries: [],
      funding: [],
    });
  const [marketRefresh, setMarketRefresh] = useState(0),
    [category, setCategory] = useState(''),
    [cartCount, setCartCount] = useState(0),
    [unread, setUnread] = useState({ updates: 0, messages: 0 }),
    [inboxSection, setInboxSection] = useState<'messages' | 'updates'>('messages'),
    // Set when a notification opens a particular plan, or the Group buys panel on Home.
    [plannerFocus, setPlannerFocus] = useState<string | null>(null),
    [marketTool, setMarketTool] = useState<'' | 'groups'>(''),
    // The order a notification opened; Orders shows it first, on its tab.
    [focusBooking, setFocusBooking] = useState<string | null>(null);
  const refreshUnread = useCallback(() => {
    Promise.all([request('get', '/notifications'), request('get', '/conversations')])
      .then(([n, c]) =>
        setUnread({
          updates: n.filter((x: any) => !x.read_at).length,
          messages: c.reduce((sum: number, x: any) => sum + (x.unread || 0), 0),
        }),
      )
      .catch(() => {});
  }, []);
  const refreshCart = useCallback(() => {
    if (actingAs()) return setCartCount(0);
    request('get', '/cart')
      .then((c) => setCartCount(c.line_count))
      .catch(() => {});
  }, []);
  const [offline, setOfflineBanner] = useState(false);
  useEffect(() => onConnectivity(setOfflineBanner), []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
      listing: Listing;
      variantId?: string;
      quantity?: number;
      attributionToken?: string;
      quote?: { id: string; price_kobo: number; business_name: string };
    } | null>(null),
    [shop, setShop] = useState<string | null>(null),
    [editing, setEditing] = useState<{ listing: Listing | null } | null>(null),
    [history, setHistory] = useState<{ booking: Booking; events: OrderEvent[] } | null>(null);
  useEffect(
    () =>
      onTeamAccessLost((message) => {
        setNotice(`${message} You’re back on your own account.`);
        void refresh();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(
    () =>
      onSessionExpired(() => {
        setMe(null);
        setSeller(null);
        setError('');
      }),
    [],
  );
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, o, w, st, own] = await Promise.all([
        request('get', '/me'),
        request('get', '/bookings'),
        // The shop's wallet stays with the owner; team members don't see it.
        actingAs() ? Promise.resolve(null) : request('get', '/wallet'),
        request('get', '/settings'),
        request('get', '/listings', { query: { mine: 'true' } }),
      ]);
      setMe(m.user);
      setSeller(m.seller);
      setBookings(o);
      setWallet(w ?? { balance_kobo: 0, seller_payable_kobo: 0, entries: [], funding: [] });
      setSettings(st);
      setMine(own);
      refreshCart();
      refreshUnread();
      setMarketRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refreshCart, refreshUnread]);
  useEffect(() => {
    restoreToken()
      .then(async (exists) => {
        if (exists) {
          try {
            const m = await request('get', '/me');
            setMe(m.user);
            await refresh();
          } catch {
            await saveToken('');
          }
        }
      })
      .finally(() => setInitializing(false));
  }, [refresh]);
  // Shared shop links: https://…/?seller=ID (web) or ahia://seller/ID (app).
  const [linkedSeller, setLinkedSeller] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') setLinkedSeller(sellerFromUrl(window.location.href));
    else void Linking.getInitialURL().then((url) => setLinkedSeller(sellerFromUrl(url)));
    const sub = Linking.addEventListener('url', ({ url }) => setLinkedSeller(sellerFromUrl(url)));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!me || !linkedSeller) return;
    setShop(linkedSeller);
    setLinkedSeller(null);
    if (Platform.OS === 'web') window.history.replaceState(null, '', window.location.pathname);
  }, [me?.id, linkedSeller]);
  /**
   * Opens where a notification came from. Links: "booking:<id>", "planner" or "planner:<plan id>",
   * "messages", "riders", "drive", "wallet", "sell" / "sell:requests", "account" /
   * "account:requests", "business", "orders", "home" / "home:groups", "listing:<id>".
   */
  const openLink = (link: string | null | undefined) => {
    if (!link) return;
    const [where, id] = link.split(/:(.*)/s);
    setSelected(null);
    setEditing(null);
    setHistory(null);
    setShop(null);
    if (where === 'booking' && id) {
      setFocusBooking(id);
      changeTab('Bookings');
    } else if (where === 'planner') {
      changeTab('Planner');
      setPlannerFocus(id || null);
    } else if (where === 'messages') {
      setInboxSection('messages');
      changeTab('Inbox');
    } else if (where === 'listing' && id)
      void request('get', '/listings/{id}', { params: { id } })
        .then((l) => ctx.openListing(l as Listing))
        .catch(() => changeTab('Market'));
    else if (where === 'home') {
      setMarketTool(id === 'groups' ? 'groups' : '');
      changeTab('Market');
    } else {
      const tabs: Record<string, Tab> = {
        riders: 'Riders',
        drive: 'Drive',
        wallet: 'Wallet',
        sell: 'Sell',
        account: 'Account',
        business: 'Business',
        orders: 'Bookings',
      };
      changeTab(tabs[where] || 'Inbox');
    }
  };
  useEffect(() => {
    if (!me) return;
    void registerForPush();
    return onNotificationTap((data) => {
      openLink(
        data.link ||
          (data.booking_id ? `booking:${data.booking_id}` : linkForKind(String(data.kind || ''))),
      );
      void refresh();
    });
  }, [me?.id, refresh]);
  useEffect(() => {
    if (!me) return;
    const closeLive = liveUpdates(() => void refresh());
    const timer = setInterval(() => void refresh(), 20000);
    return () => {
      clearInterval(timer);
      closeLive();
    };
  }, [me?.id, refresh]);
  async function run(fn: () => Promise<unknown>, message = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      if (me) await refresh();
    } catch (e) {
      setPopup((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const changeTab = (t: Tab) => {
    // Each tab opens at its top, not at the scroll position of the previous one.
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (t === 'Inbox') setConversationId(null);
    if (t !== 'Inbox') setInboxSection('messages');
    // A notification's focus applies once; normal navigation starts fresh.
    setPlannerFocus(null);
    setMarketTool('');
    setFocusBooking(null);
    setTab(t);
    setSelected(null);
    setShop(null);
    setEditing(null);
    setHistory(null);
    setError('');
    setNotice('');
  };
  const ctx: AppState = {
    scrollToView: (view) => {
      const scroller: any = scrollRef.current;
      view?.measureInWindow?.((_x: number, y: number) => {
        const go = (top: number) =>
          scrollRef.current?.scrollTo({
            y: Math.max(0, scrollY.current + y - top - 12),
            animated: true,
          });
        if (scroller?.measureInWindow)
          scroller.measureInWindow((_a: number, top: number) => go(top));
        else go(90);
      });
    },
    cartCount,
    me,
    seller,
    settings,
    busy,
    run,
    refresh,
    setTab: (t) => {
      setSelected(null);
      setShop(null);
      setEditing(null);
      setHistory(null);
      setTab(t);
    },
    openHistory: (booking) =>
      void run(async () => {
        const events = await request('get', '/bookings/{id}/events', {
          params: { id: booking.id },
        });
        setHistory({ booking, events });
      }),
    openConversation: (id) => {
      setSelected(null);
      setConversationId(id);
      setTab('Inbox');
    },
    openSeller: (sellerId) => {
      setSelected(null);
      setHistory(null);
      setEditing(null);
      setShop(sellerId);
    },
    openListing: (listing, options) => {
      setSelected({ listing, ...options });
      setError('');
      setNotice('');
    },
  };
  if (initializing)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color="#1f754a" />
        <Text style={s.muted}>Opening your market…</Text>
      </SafeAreaView>
    );
  if (!me)
    return (
      <AuthScreen
        onSignedIn={async (user) => {
          setMe(user);
          await refresh();
        }}
      />
    );
  const incoming = bookings.filter((b) => b.seller_id === me.id),
    outgoing = bookings.filter((b) => b.buyer_id === me.id);
  let screen: React.ReactNode;
  if (history) screen = <HistoryView history={history} onBack={() => setHistory(null)} />;
  else if (selected)
    screen = (
      <ListingDetail
        key={selected.listing.id}
        listing={selected.listing}
        initialVariantId={selected.variantId}
        initialQuantity={selected.quantity}
        attributionToken={selected.attributionToken}
        quote={selected.quote}
        onBack={() => setSelected(null)}
      />
    );
  else if (shop) screen = <SellerShop sellerId={shop} onBack={() => setShop(null)} />;
  else if (editing)
    screen = <ListingEditor listing={editing.listing} onDone={() => setEditing(null)} />;
  else if (tab === 'Inbox')
    screen = (
      <CommunityScreen
        user={me}
        key={inboxSection}
        initialSection={inboxSection}
        initialConversation={conversationId}
        onBooking={(id) => {
          changeTab('Bookings');
          setFocusBooking(id);
        }}
        onShopping={() => changeTab('Riders')}
        onLink={openLink}
      />
    );
  else if (tab === 'Market')
    screen = (
      <DiscoveryPanel
        key={marketTool || 'home'}
        initialTool={marketTool}
        refreshVersion={marketRefresh}
        name={me.name}
        onSelect={ctx.openListing}
        category={category}
        onCategory={setCategory}
      />
    );
  else if (tab === 'Categories')
    screen = (
      <CategoriesScreen
        current={category}
        onPick={(c) => {
          setCategory(c);
          changeTab('Market');
        }}
      />
    );
  else if (tab === 'Bookings')
    screen = <BookingsScreen outgoing={outgoing} incoming={incoming} focusId={focusBooking} />;
  else if (tab === 'Sell')
    screen = (
      <SellScreen
        mine={mine}
        incoming={incoming}
        onEditListing={(listing) => setEditing({ listing })}
      />
    );
  else if (tab === 'Wallet') screen = <WalletScreen wallet={wallet} />;
  else if (tab === 'Riders')
    screen = featureOn(settings, 'shopping') ? (
      <RidersScreen />
    ) : (
      <BookingsScreen outgoing={outgoing} />
    );
  else if (tab === 'Drive') screen = <DriveScreen />;
  else if (tab === 'Cart') screen = <CartScreen onChanged={refreshCart} />;
  else if (tab === 'Nearby') screen = <NearbySellersScreen />;
  else if (tab === 'Business') screen = <BusinessHubScreen />;
  else if (tab === 'Planner')
    screen = (
      <PlannerScreen
        key={plannerFocus || 'list'}
        onCartChanged={refreshCart}
        initialPlanId={plannerFocus}
      />
    );
  else
    screen = (
      <AccountScreen
        onSignedOut={() => {
          setMe(null);
          setSeller(null);
        }}
      />
    );
  const narrow = width < 480;
  return (
    <AppContext.Provider value={ctx}>
      <SafeAreaView style={s.safe}>
        <StatusBar style="dark" />
        <View style={s.topbar}>
          <Brand size={38} tagline={narrow ? undefined : 'Buy · Sell · Discover nearby'} />
          <View style={s.topActions}>
            {!actingAs() && wallet && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  balanceHidden
                    ? 'Wallet. Open wallet'
                    : `Wallet balance ${money(wallet.balance_kobo)}. Open wallet`
                }
                onPress={() => changeTab('Wallet')}
                style={s.walletPill}
              >
                <Text style={s.walletPillIcon}>👛</Text>
                <Text style={s.walletPillText} numberOfLines={1}>
                  {balanceHidden ? '₦ ••••' : shortMoney(wallet.balance_kobo)}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
              onPress={() => changeTab('Cart')}
              style={s.iconButton}
            >
              <Svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#18432e"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <Path d="M3 4h2l2.4 11h10.2L20 8H6.2M9 20.5h.01M17 20.5h.01" />
              </Svg>
              {cartCount > 0 && (
                <View style={s.countBadge}>
                  <Text style={s.countText}>{cartCount > 99 ? '99+' : cartCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Updates, ${unread.updates} unread`}
              onPress={() => {
                setInboxSection('updates');
                changeTab('Inbox');
              }}
              style={s.iconButton}
            >
              <Svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#18432e"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
              </Svg>
              {unread.updates > 0 && (
                <View style={[s.countBadge, { backgroundColor: '#d63a2c' }]}>
                  <Text style={[s.countText, { color: '#fff' }]}>
                    {unread.updates > 99 ? '99+' : unread.updates}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable accessibilityLabel="Open account" onPress={() => changeTab('Account')}>
              <View style={s.avatar}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                  {me.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
        <ScrollView
          ref={scrollRef as any}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={32}
          style={s.flex}
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void refresh()}
              tintColor="#1f754a"
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {me?.acting_member && (
            <View style={s.acting}>
              <Text style={s.actingText}>
                You’re working for {seller?.business_name || me.name} as{' '}
                {me.acting_member.role === 'MANAGER' ? 'a manager' : 'staff'}.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void run(async () => {
                    await actAsSeller('');
                    changeTab('Market');
                  }, 'Back on your own account.')
                }
              >
                <Text style={s.actingSwitch}>Switch back</Text>
              </Pressable>
            </View>
          )}
          {settings?.payment_mode === 'demo' && (
            <View style={s.demo}>
              <Text style={s.demoText}>{t('common.demo')}</Text>
            </View>
          )}
          {offline && (
            <Alert text="You’re offline. Showing your last saved bookings and wallet; changes will need a connection." />
          )}
          {error && <Alert error text={error} />} {notice && <Alert text={notice} />}
          <FadeIn key={tab}>{screen}</FadeIn>
          <Text style={s.bottomNote}>{t('footer.note')}</Text>
        </ScrollView>
        <Modal
          visible={!!popup}
          transparent
          animationType="fade"
          onRequestClose={() => setPopup('')}
        >
          <View style={s.popupBackdrop}>
            <View style={s.popup} accessibilityRole="alert">
              <Text style={s.popupTitle}>
                {/wallet/i.test(popup) ? '👛 Not enough in your wallet' : 'That didn’t go through'}
              </Text>
              <Text style={s.body}>{popup}</Text>
              <View style={{ gap: 10 }}>
                {/wallet/i.test(popup) && !actingAs() && (
                  <Button
                    title="Add money to wallet"
                    onPress={() => {
                      setPopup('');
                      changeTab('Wallet');
                    }}
                  />
                )}
                <Button secondary={/wallet/i.test(popup)} title="OK" onPress={() => setPopup('')} />
              </View>
            </View>
          </View>
        </Modal>
        <BottomNavigation
          tab={tab}
          onNavigate={changeTab}
          hidden={featureOn(settings, 'shopping') ? [] : ['Riders']}
          payments={!featureOn(settings, 'wallet')}
          badges={{ Inbox: unread.messages }}
        />
      </SafeAreaView>
    </AppContext.Provider>
  );
}
