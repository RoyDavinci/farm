import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { request } from './request';
export function SellerTrust({ sellerId }: { sellerId: string }) {
  const [seller, setSeller] = useState<any>(null),
    [favourite, setFavourite] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      request('get', '/sellers/{id}', { params: { id: sellerId } }),
      request('get', '/favourites'),
    ])
      .then(([s, f]) => {
        setSeller(s);
        setFavourite(f.some((v: any) => v.user_id === sellerId));
      })
      .catch((e) => setError(e.message));
  }, [sellerId]);
  return (
    <View style={s.box}>
      {seller && (
        <>
          <Text style={s.bold}>
            {seller.rating_count
              ? `★ ${seller.rating_avg} · ${seller.rating_count} verified pickup reviews`
              : 'No pickup reviews yet'}
          </Text>
          <Pressable
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await request(favourite ? 'delete' : 'put', '/favourites/{id}', {
                  params: { id: sellerId },
                });
                setFavourite(!favourite);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={s.link}>
              {favourite ? '♥ Favourite seller' : '♡ Save seller to favourites'}
            </Text>
          </Pressable>
          {seller.ratings.slice(0, 3).map((r: any, i: number) => (
            <View key={i} style={s.review}>
              <Text style={s.small}>
                {'★'.repeat(r.score)} · {r.buyer_name}
              </Text>
              <Text style={s.body}>{r.comment}</Text>
            </View>
          ))}
        </>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [score, setScore] = useState(5),
    [comment, setComment] = useState(''),
    [sent, setSent] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request('get', '/bookings/{id}/rating', { params: { id: bookingId } })
      .then((r) => {
        if (r) {
          setSent(true);
          setScore(r.score);
          setComment(r.comment);
        }
      })
      .catch((e) => setError(e.message));
  }, [bookingId]);
  return (
    <View style={s.box}>
      <Text style={s.bold}>{sent ? 'Your pickup review' : 'How was your pickup?'}</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <Pressable
            key={v}
            disabled={sent || busy}
            accessibilityLabel={`Rate ${v} stars`}
            onPress={() => setScore(v)}
          >
            <Text style={{ fontSize: 28, color: v <= score ? '#a2914f' : '#cde5d9' }}>★</Text>
          </Pressable>
        ))}
      </View>
      {sent ? (
        <Text style={s.body}>{comment || 'Thank you for reviewing your seller.'}</Text>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Pickup review"
            style={s.input}
            value={comment}
            onChangeText={setComment}
            maxLength={1000}
            multiline
            placeholder="Tell other buyers about your experience"
          />
          <Pressable
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                await request('post', '/bookings/{id}/{action}', {
                  params: { id: bookingId, action: 'rating' },
                  body: { score, comment },
                });
                setSent(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={s.link}>{busy ? 'Saving…' : 'Submit verified review →'}</Text>
          </Pressable>
        </>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}
const s = StyleSheet.create({
  box: { paddingVertical: 12, gap: 12, borderTopWidth: 1, borderColor: '#d8ece2' },
  bold: { fontSize: 12, color: '#306b4d', fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 20, color: '#56816b' },
  small: { fontSize: 10, color: '#7ea993' },
  link: { fontSize: 12, color: '#35845d', paddingVertical: 5 },
  error: { fontSize: 11, color: '#a16147' },
  review: { gap: 7 },
  input: {
    padding: 13,
    borderWidth: 1,
    borderColor: '#d2eade',
    borderRadius: 7,
    minHeight: 70,
    color: '#2b684a',
    backgroundColor: '#fff',
    fontSize: 12,
  },
});
