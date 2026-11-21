import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Field, Chip, s } from './ui';
export default function ProfileDetailsPanel({ subject }: { subject: 'seller' | 'driver' }) {
  const { run, busy, refresh } = useApp();
  const [open, setOpen] = useState(false),
    [details, setDetails] = useState<Record<string, any>>({}),
    [badges, setBadges] = useState<Record<string, boolean>>({}),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [listText, setListText] = useState('');
  useEffect(() => {
    if (!open) return;
    const fetchDetails =
      subject === 'seller'
        ? request('get', '/sellers/me/details')
        : request('get', '/drivers/me/details');
    void fetchDetails
      .then((d) => {
        setDetails(d.details);
        setListText(
          ((d.details as any)[subject === 'seller' ? 'categories' : 'service_areas'] || []).join(
            ', ',
          ),
        );
        setBadges(d.badges);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [open, subject]);
  const fields =
    subject === 'seller'
      ? [
          ['legal_name', 'Legal name (private)'],
          ['description', 'Business description'],
          ['country', 'Country'],
          ['street', 'Street'],
          ['market_section', 'Market section'],
          ['block', 'Block'],
          ['stall_number', 'Shop / stall number'],
          ['landmark', 'Collection landmark'],
        ]
      : [
          ['state', 'Operating state'],
          ['permit_number', 'Operating permit number'],
          ['permit_expires_at', 'Permit expiry (YYYY-MM-DD)'],
          ['insurance_reference', 'Insurance reference'],
          ['insurance_expires_at', 'Insurance expiry (YYYY-MM-DD)'],
        ];
  return (
    <View style={s.locationBox}>
      <Button
        secondary
        title={
          open
            ? 'Close profile details'
            : subject === 'seller'
              ? 'Business & structured address'
              : 'Service area, permit & insurance'
        }
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={s.small}>
            Private identity and address details are only used for verification and fulfilment.
            Address or driver-detail changes require review. Badges reflect accepted evidence, not
            simply filled fields.
          </Text>
          {error && <Text style={s.fine}>{error}</Text>}
          <View style={s.chipWrap}>
            {Object.entries(badges).map(([key, verified]) => (
              <Chip
                key={key}
                title={`${verified ? '✓' : '○'} ${key}`}
                active={verified}
                onPress={() => {}}
              />
            ))}
          </View>
          {loaded && (
            <>
              {fields.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={details[key] || ''}
                  multiline={key === 'description'}
                  onChangeText={(v: string) => setDetails({ ...details, [key]: v })}
                />
              ))}
              <Field
                label={
                  subject === 'seller'
                    ? 'Business categories (comma separated)'
                    : 'Service LGAs / areas (comma separated)'
                }
                value={listText}
                onChangeText={setListText}
              />
              <Button
                title="Save for review"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const lists = listText
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean);
                    if (subject === 'seller')
                      await request('put', '/sellers/me/details', {
                        body: { ...details, categories: lists },
                      });
                    else
                      await request('put', '/drivers/me/details', {
                        body: {
                          ...details,
                          service_areas: lists,
                          permit_expires_at: details.permit_expires_at || null,
                          insurance_expires_at: details.insurance_expires_at || null,
                        },
                      });
                    await refresh();
                    setOpen(false);
                  }, 'Profile details saved. Changes requiring verification are pending review.')
                }
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
