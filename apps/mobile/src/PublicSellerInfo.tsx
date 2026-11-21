import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { request } from './request';
import { s } from './ui';
export default function PublicSellerInfo({ sellerId }: { sellerId: string }) {
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => {
    void request('get', '/sellers/{id}/public-profile', { params: { id: sellerId } })
      .then(setProfile)
      .catch(() => {});
  }, [sellerId]);
  if (!profile) return null;
  const badges = Object.entries(profile.badges)
    .filter(([, value]) => value)
    .map(([key]) => key);
  return (
    <View style={s.locationBox}>
      {profile.description && <Text style={s.body}>{profile.description}</Text>}
      {profile.categories?.length > 0 && (
        <Text style={s.small}>{profile.categories.join(' · ')}</Text>
      )}
      <Text style={s.fine}>
        {badges.length
          ? `Verified evidence: ${badges.join(' · ')}`
          : 'Seller approved; additional verification evidence is not yet confirmed.'}
      </Text>
    </View>
  );
}
