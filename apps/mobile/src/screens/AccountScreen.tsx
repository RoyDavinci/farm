import DiscoveryPreferencesPanel from '../DiscoveryPreferencesPanel';
import { Text, View } from 'react-native';
import AccountPanel from '../AccountPanel';
import { saveToken } from '../api';
import { useApp } from '../AppContext';
import { languages, useI18n } from '../i18n';
import { unregisterPush } from '../push';
import { request } from '../request';
import { Button, Chip, s } from '../ui';

export default function AccountScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const { me, settings, busy, run, refresh } = useApp();
  const { t, language, setLanguage } = useI18n();
  return (
    <>
      <Text style={s.heading}>{t('account.heading')}</Text>
      <View style={s.orderCard}>
        <Text style={s.sectionTitle}>{t('account.language')}</Text>
        <View style={s.chipWrap}>
          {languages.map((l) => (
            <Chip
              key={l.code}
              title={l.label}
              active={language === l.code}
              onPress={() => setLanguage(l.code)}
            />
          ))}
        </View>
      </View>
      <DiscoveryPreferencesPanel />
      <AccountPanel user={me} onUpdate={refresh} />
      <View style={s.orderCard}>
        <Text style={s.sectionTitle}>{me.name}</Text>
        <Text style={s.body}>{me.email}</Text>
        <Text style={s.body}>{me.phone}</Text>
        <Text style={s.fine}>
          Your account can buy and sell. Seller approval is managed separately.
        </Text>
      </View>
      <View style={s.orderCard}>
        <Text style={s.bold}>Zuru</Text>
        <Text style={s.body}>
          A marketplace connecting buyers, sellers and riders across Nigeria.
        </Text>
        <Text style={s.small}>
          Reservations: {settings?.reservation_hours || 168} hours · Stock updates: immediate
        </Text>
      </View>
      <Button
        secondary
        title={t('account.signOut')}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await unregisterPush();
            await request('post', '/auth/logout');
            await saveToken('');
            onSignedOut();
          }, '')
        }
      />
    </>
  );
}
