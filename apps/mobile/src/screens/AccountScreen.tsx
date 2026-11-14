import React from 'react';
import { View, Text } from 'react-native';
import { api, saveToken } from '../api';
import AccountPanel from '../AccountPanel';
import { unregisterPush } from '../push';
import { Field, Button, Chip, Badge, Empty, Back, s } from '../ui';
import { useApp } from '../AppContext';
import { useI18n, languages } from '../i18n';

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
        <Text style={s.bold}>Farmers Market</Text>
        <Text style={s.body}>A fresh connection between local growers and their communities.</Text>
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
            await api('/auth/logout', 'POST');
            await saveToken('');
            onSignedOut();
          }, '')
        }
      />
    </>
  );
}
