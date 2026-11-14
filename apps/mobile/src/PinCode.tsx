import React, { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, s } from './ui';

/**
 * Handover codes for deliveries. Each 6-digit PIN is also shown as a QR code so the other person
 * can scan instead of typing:
 *   pickup   — the driver shows it, the seller scans it before handing the order over;
 *   delivery — the buyer shows it, the driver scans it at the door.
 * The QR names the delivery and the step, so a code from another order or step is rejected on the
 * phone before anything is sent. The server still checks the PIN itself.
 */
export type PinKind = 'pickup' | 'delivery';
const PREFIX = 'farmersmarket:pin';

export const pinPayload = (kind: PinKind, deliveryId: string, pin: string) =>
  `${PREFIX}:${kind}:${deliveryId}:${pin}`;

/** Returns the PIN if the scanned text is this delivery's code for this step. */
export function readPin(
  text: string,
  kind: PinKind,
  deliveryId: string,
): { pin?: string; error?: string } {
  const m = /^farmersmarket:pin:(pickup|delivery):([\w-]+):(\d{6})$/.exec(text.trim());
  if (!m) return { error: 'This is not a Farmers Market handover code.' };
  if (m[1] !== kind)
    return {
      error:
        kind === 'pickup'
          ? 'That is the buyer’s delivery code. Scan the driver’s collection code.'
          : 'That is a collection code. Scan the buyer’s delivery code.',
    };
  if (m[2] !== deliveryId) return { error: 'This code belongs to a different order.' };
  return { pin: m[3] };
}

export function PinQr({
  kind,
  deliveryId,
  pin,
  title,
  hint,
}: {
  kind: PinKind;
  deliveryId: string;
  pin: string;
  title: string;
  hint: string;
}) {
  return (
    <View style={s.codeBox}>
      <Text style={s.eyebrow}>{title}</Text>
      <View style={{ padding: 10, backgroundColor: '#fff', borderRadius: 8 }}>
        <QRCode value={pinPayload(kind, deliveryId, pin)} size={170} />
      </View>
      <Text style={s.pickupCode}>{pin}</Text>
      <Text style={s.small}>{hint}</Text>
    </View>
  );
}

/** "Scan code" button that opens the camera and returns a verified PIN. */
export function PinScanner({
  kind,
  deliveryId,
  onPin,
}: {
  kind: PinKind;
  deliveryId: string;
  onPin: (pin: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  if (Platform.OS === 'web') return null; // On the web, type the 6 digits instead.
  if (!open)
    return (
      <Button
        secondary
        title="Scan code with camera"
        onPress={async () => {
          setError('');
          const granted = permission?.granted || (await requestPermission()).granted;
          if (!granted) setError('Allow camera access to scan, or type the 6 digits.');
          else setOpen(true);
        }}
      />
    );
  return (
    <View style={{ gap: 8 }}>
      <CameraView
        style={{ height: 260, borderRadius: 10, overflow: 'hidden' }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          const result = readPin(data, kind, deliveryId);
          if (result.pin) {
            setOpen(false);
            onPin(result.pin);
          } else setError(result.error ?? 'Could not read this code.');
        }}
      />
      {!!error && <Text style={s.fine}>{error}</Text>}
      <Pressable onPress={() => setOpen(false)}>
        <Text style={s.link}>Type the code instead</Text>
      </Pressable>
    </View>
  );
}
