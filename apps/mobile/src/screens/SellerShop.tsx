import PublicSellerInfo from '../PublicSellerInfo';
import { money, statusLabel, type Listing } from '@zuru/shared';
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { request } from '../request';
import { shareOnWhatsApp, shopMessage } from '../share';
import { SellerTrust } from '../TrustPanels';
import { Back, Button, Empty, produceIcon, s } from '../ui';

export default function SellerShop({ sellerId, onBack }: { sellerId: string; onBack: () => void }) {
  const { me, openListing } = useApp();
  const [seller, setSeller] = useState<any>(null),
    [listings, setListings] = useState<Listing[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      request('get', '/sellers/{id}', { params: { id: sellerId } }),
      request('get', '/sellers/{id}/listings', { params: { id: sellerId } }),
    ])
      .then(([profile, items]) => {
        setSeller(profile);
        setListings(items);
      })
      .catch((e) => setError(e.message));
  }, [sellerId]);
  return (
    <>
      <Back onPress={onBack} />
      {error ? (
        <Empty title="Shop unavailable" text={error} />
      ) : !seller ? (
        <Text style={s.muted}>Opening shop…</Text>
      ) : (
        <>
          <Text style={s.eyebrow}>
            {statusLabel(seller.business_type).toUpperCase()} · {seller.area.toUpperCase()},{' '}
            {seller.city.toUpperCase()}
          </Text>
          <Text style={s.heading}>{seller.business_name}</Text>
          <PublicSellerInfo sellerId={sellerId} />
          <SellerTrust sellerId={sellerId} />
          <Button
            secondary
            title="Share shop on WhatsApp"
            onPress={() => void shareOnWhatsApp(shopMessage(seller))}
          />
          <Text style={s.sectionTitle}>Products from this seller</Text>
          {listings.length ? (
            <View style={s.productGrid}>
              {listings.map((l) => (
                <Pressable key={l.id} style={s.product} onPress={() => openListing(l)}>
                  <View style={[s.productPicture, { backgroundColor: '#edf1df' }]}>
                    {l.thumbnail_url || l.image_url ? (
                      <Image
                        source={{ uri: (l.thumbnail_url || l.image_url)! }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    ) : (
                      <Text style={s.productEmoji}>{produceIcon(l.category)}</Text>
                    )}
                    {!l.in_stock && (
                      <View style={s.freshTag}>
                        <Text style={s.tagText}>OUT OF STOCK</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.productBody}>
                    <Text style={s.productName}>{l.title}</Text>
                    <Text style={s.productPrice}>
                      {money(l.price_kobo)} / {l.unit}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <Empty
              title="Nothing listed right now"
              text="Save this seller to hear about new products."
            />
          )}
          {sellerId === me.id && <Text style={s.fine}>This is how buyers see your shop.</Text>}
        </>
      )}
    </>
  );
}
