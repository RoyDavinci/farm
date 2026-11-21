import { useEffect, useState } from 'react';
import { Text, View, Switch, Platform } from 'react-native';
import { useApp } from './AppContext';
import {
  backgroundTrackingEnabled,
  startBackgroundTracking,
  stopBackgroundTracking,
} from './backgroundTracking';
import { request } from './request';
import { s } from './ui';
export default function BackgroundTrackingControl({ online }: { online: boolean }) {
  const { me, busy, run } = useApp();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void backgroundTrackingEnabled().then(setEnabled);
    if (!online) {
      void stopBackgroundTracking().then(() => setEnabled(false));
    }
  }, [online]);
  return (
    <View style={s.locationBox}>
      <View style={s.rowBetween}>
        <Text style={s.bold}>Share active delivery location in background</Text>
        <Switch
          value={enabled}
          disabled={busy || !online || Platform.OS === 'web'}
          onValueChange={(v) =>
            void run(async () => {
              if (v) await startBackgroundTracking(me.id);
              else {
                await stopBackgroundTracking();
                await request('put', '/drivers/me/background-consent', {
                  body: { enabled: false },
                });
              }
              setEnabled(v);
            })
          }
        />
      </View>
      <Text style={s.fine}>
        Optional. While online, your phone can update active delivery/shopping jobs when this app is
        behind another app. Your device shows location use. Turning off, going offline or signing
        out stops this task. OS power settings and force-closing can stop updates; this is not a
        guaranteed emergency tracker. Web supports foreground tracking only.
      </Text>
    </View>
  );
}
