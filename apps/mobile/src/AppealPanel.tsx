import { useState } from 'react';
import { Text, View } from 'react-native';
import { request } from './request';
import { useApp } from './AppContext';
import { Button, Field, s } from './ui';
export default function AppealPanel({ disputeId }: { disputeId: string }) {
  const { run, busy } = useApp();
  const [reason, setReason] = useState(''),
    [sent, setSent] = useState(false);
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Request review of this outcome</Text>
      <Text style={s.small}>
        Explain the evidence or decision you want reviewed. The proposed review window is seven days
        unless operations sets another deadline. An appeal does not automatically move money.
      </Text>
      {sent ? (
        <Text style={s.body}>Your appeal is recorded for staff review.</Text>
      ) : (
        <>
          <Field label="Reason for appeal" value={reason} onChangeText={setReason} multiline />
          <Button
            title="Submit appeal"
            disabled={busy || reason.trim().length < 10}
            onPress={() =>
              void run(async () => {
                await request('post', '/disputes/{id}/appeal', {
                  params: { id: disputeId },
                  body: { reason },
                });
                setSent(true);
              }, 'Appeal submitted.')
            }
          />
        </>
      )}
    </View>
  );
}
