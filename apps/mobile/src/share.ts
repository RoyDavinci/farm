import { Linking, Platform, Share } from 'react-native';

export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'http://localhost:8095').replace(
  /\/$/,
  '',
);

export const shopLink = (sellerId: string) => `${WEB_URL}/?seller=${encodeURIComponent(sellerId)}`;

/** Extracts a seller id from a shared link: https://…/?seller=ID or ahia://seller/ID. */
export function sellerFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const query = /[?&]seller=([A-Za-z0-9-]{8,64})/.exec(url);
  if (query) return decodeURIComponent(query[1]);
  const path = /seller\/([A-Za-z0-9-]{8,64})/.exec(url);
  return path ? path[1] : null;
}

/** Opens WhatsApp with a ready-to-send message, falling back to the system share sheet. */
export async function shareOnWhatsApp(text: string) {
  const app = `whatsapp://send?text=${encodeURIComponent(text)}`;
  const web = `https://wa.me/?text=${encodeURIComponent(text)}`;
  try {
    if (Platform.OS !== 'web' && (await Linking.canOpenURL(app))) return await Linking.openURL(app);
    if (Platform.OS === 'web') return void window.open(web, '_blank', 'noopener');
    await Linking.openURL(web);
  } catch {
    await Share.share({ message: text });
  }
}

export function shopMessage(seller: {
  user_id: string;
  business_name: string;
  area: string;
  city: string;
}) {
  return `Shop ${seller.business_name} in ${seller.area}, ${seller.city}. Book on Ahia: ${shopLink(seller.user_id)}`;
}
