import { featureOn } from './src/features';
import BottomNavigation from './src/BottomNavigation';
import RidersScreen from './src/screens/RidersScreen';
import {
  type Booking,
  type Listing,
  type OrderEvent,
  type Seller,
  type Settings,
} from '@ahia/shared';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { liveUpdates, onSessionExpired, restoreToken, saveToken } from './src/api';
import { AppContext, type AppState, type Tab } from './src/AppContext';
import AuthScreen from './src/AuthScreen';
import CommunityScreen from './src/CommunityScreen';
import DiscoveryPanel from './src/DiscoveryPanel';
import CategoriesScreen from './src/CategoriesScreen';
import CartScreen from './src/screens/CartScreen';
import PlannerScreen from './src/screens/PlannerScreen';
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
import { Alert, Brand, FadeIn, s } from './src/ui';

export default function App() {
  return (
    <LanguageProvider>
      <Main />
    </LanguageProvider>
  );
}

function Main() {
  const { t } = useI18n();
  const [me, setMe] = useState<any>(null),
    [seller, setSeller] = useState<Seller | null>(null),
    [initializing, setInitializing] = useState(true),
    [tab, setTab] = useState<Tab>('Market'),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
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
    [cartCount, setCartCount] = useState(0);
  const refreshCart = useCallback(() => {
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
    } | null>(null),
    [shop, setShop] = useState<string | null>(null),
    [editing, setEditing] = useState<{ listing: Listing | null } | null>(null),
    [history, setHistory] = useState<{ booking: Booking; events: OrderEvent[] } | null>(null);
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
        request('get', '/wallet'),
        request('get', '/settings'),
        request('get', '/listings', { query: { mine: 'true' } }),
      ]);
      setMe(m.user);
      setSeller(m.seller);
      setBookings(o);
      setWallet(w);
      setSettings(st);
      setMine(own);
      refreshCart();
      setMarketRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refreshCart]);
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
  useEffect(() => {
    if (!me) return;
    void registerForPush();
    return onNotificationTap((data) => {
      setSelected(null);
      setEditing(null);
      setHistory(null);
      if (data.kind === 'shopping') setTab('Riders');
      else if (data.kind === 'message') setTab('Inbox');
      else if (data.kind === 'payout') setTab('Wallet');
      else if (data.booking_id) setTab('Bookings');
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const changeTab = (t: Tab) => {
    if (t === 'Inbox') setConversationId(null);
    setTab(t);
    setSelected(null);
    setShop(null);
    setEditing(null);
    setHistory(null);
    setError('');
    setNotice('');
  };
  const ctx: AppState = {
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
        <ActivityIndicator color="#26408f" />
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
        initialConversation={conversationId}
        onBooking={() => changeTab('Bookings')}
        onShopping={() => changeTab('Riders')}
      />
    );
  else if (tab === 'Market')
    screen = (
      <DiscoveryPanel
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
  else if (tab === 'Bookings') screen = <BookingsScreen outgoing={outgoing} />;
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
  else if (tab === 'Planner') screen = <PlannerScreen onCartChanged={refreshCart} />;
  else
    screen = (
      <AccountScreen
        onSignedOut={() => {
          setMe(null);
          setSeller(null);
        }}
      />
    );
  return (
    <AppContext.Provider value={ctx}>
      <SafeAreaView style={s.safe}>
        <StatusBar style="dark" />
        <View style={s.topbar}>
          <Brand size={38} tagline="Buy · Sell · Discover nearby" />
          <View style={s.topActions}>
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
                stroke="#1d2a52"
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
              accessibilityLabel="Messages and updates"
              onPress={() => changeTab('Inbox')}
              style={s.iconButton}
            >
              <Svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1d2a52"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
              </Svg>
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
          style={s.flex}
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void refresh()}
              tintColor="#26408f"
            />
          }
          keyboardShouldPersistTaps="handled"
        >
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
        <BottomNavigation
          tab={tab}
          onNavigate={changeTab}
          hidden={featureOn(settings, 'shopping') ? [] : ['Riders']}
          payments={!featureOn(settings, 'wallet')}
        />
      </SafeAreaView>
    </AppContext.Provider>
  );
}
