import { money } from '@ahia/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';

type Plan = Awaited<ReturnType<typeof loadPlans>>[number];
const loadPlans = () => request('get', '/plans');

/**
 * My Planner on Home: the latest active plan with its progress, or an invitation to start one.
 * Tapping opens the Planner tab.
 */
export default function PlannerHomeCard({ refreshVersion = 0 }: { refreshVersion?: number }) {
  const { setTab } = useApp();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => {
    void loadPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [refreshVersion]);
  const active = (plans || []).filter((p) => p.status === 'ACTIVE');
  const plan = active[0];
  const done = plan ? plan.summary.done_count : 0,
    total = plan ? plan.summary.item_count : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open My Planner"
      style={styles.card}
      onPress={() => setTab('Planner')}
    >
      <View style={styles.head}>
        <Text style={styles.icon}>🗓️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>MY PLANNER</Text>
          <Text style={styles.title} numberOfLines={1}>
            {plan ? plan.title : 'Plan it, then buy it nearby'}
          </Text>
        </View>
        <Text style={styles.open}>{plan ? 'Continue ›' : 'Start ›'}</Text>
      </View>
      {plan ? (
        <>
          <View style={styles.track}>
            <View
              style={[styles.fill, { width: `${total ? Math.round((done / total) * 100) : 0}%` }]}
            />
          </View>
          <Text style={styles.meta}>
            {done} of {total} items done
            {plan.summary.budget_kobo != null ? ` · budget ${money(plan.summary.budget_kobo)}` : ''}
            {active.length > 1 ? ` · ${active.length} active plans` : ''}
          </Text>
        </>
      ) : (
        <View style={styles.ideas}>
          {['🍲 Weekly meals', '🎉 A party', '🏠 Moving home', '🎒 Back to school'].map((i) => (
            <View key={i} style={styles.idea}>
              <Text style={styles.ideaText}>{i}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0c3a25',
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { fontSize: 30 },
  eyebrow: { color: '#f5a524', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  open: { color: '#f5a524', fontWeight: '800', fontSize: 14 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#3ddc84' },
  meta: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  idea: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ideaText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
