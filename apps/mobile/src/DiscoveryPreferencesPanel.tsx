import { useState } from 'react';
import { Text, View, Switch } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Field, Chip, s } from './ui';
export default function DiscoveryPreferencesPanel() {
  const { run, busy, settings } = useApp();
  const [open, setOpen] = useState(false),
    [prefs, setPrefs] = useState<any>(null);
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={open ? 'Close discovery preferences' : 'Product interests & local summaries'}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            if (!open) setPrefs(await request('get', '/discovery/preferences'));
            setOpen(!open);
          })
        }
      />
      {open && prefs && (
        <>
          <Text style={s.small}>
            Select categories you care about. Local summaries need both this opt-in and promotional
            notifications enabled. Turning either off stops queued summary delivery.
          </Text>
          <View style={s.chipWrap}>
            {(settings?.catalog.categories || []).map((c) => (
              <Chip
                key={c}
                title={c}
                active={prefs.categories.includes(c)}
                onPress={() =>
                  setPrefs({
                    ...prefs,
                    categories: prefs.categories.includes(c)
                      ? prefs.categories.filter((v: string) => v !== c)
                      : [...prefs.categories, c],
                  })
                }
              />
            ))}
          </View>
          <Field
            label="Summary state"
            value={prefs.state}
            onChangeText={(v: string) => setPrefs({ ...prefs, state: v })}
          />
          <Field
            label="Summary LGA"
            value={prefs.lga}
            onChangeText={(v: string) => setPrefs({ ...prefs, lga: v })}
          />
          <View style={s.rowBetween}>
            <Text style={s.small}>Optional local product summaries</Text>
            <Switch
              value={prefs.digest_enabled}
              onValueChange={(v) => setPrefs({ ...prefs, digest_enabled: v })}
            />
          </View>
          <View style={s.chipWrap}>
            {['DAILY', 'WEEKLY'].map((f) => (
              <Chip
                key={f}
                title={f.toLowerCase()}
                active={prefs.digest_frequency === f}
                onPress={() => setPrefs({ ...prefs, digest_frequency: f })}
              />
            ))}
          </View>
          <Button
            title="Save discovery preferences"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await request('put', '/discovery/preferences', { body: prefs });
                setOpen(false);
              }, 'Discovery preferences saved.')
            }
          />
        </>
      )}
    </View>
  );
}
