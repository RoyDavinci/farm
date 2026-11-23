import { money } from '@ahia/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from './AppContext';
import { useI18n } from './i18n';
import { request } from './request';
import { Button, FadeIn, PressScale } from './ui';

const BRAND = '#1f754a',
  INK = '#143022',
  MUTED = '#587667',
  SOFT = '#e9f6ef';
const DAYS = [
  ['MON', 'M'],
  ['TUE', 'T'],
  ['WED', 'W'],
  ['THU', 'T'],
  ['FRI', 'F'],
  ['SAT', 'S'],
  ['SUN', 'S'],
];
const QUALITY = [
  { id: 'BASIC', icon: '🪙', label: 'planner.basic', hint: 'planner.basicHint' },
  { id: 'STANDARD', icon: '⭐', label: 'planner.standard', hint: 'planner.standardHint' },
  { id: 'PREMIUM', icon: '💎', label: 'planner.premium', hint: 'planner.premiumHint' },
] as const;

type Answers = Record<string, any>;
type Preview = {
  total_kobo: number;
  full_kobo: number;
  budget_kobo: number | null;
  fits: boolean;
  changes: string[];
  item_count: number;
  servings: number;
  per_serving_kobo: number;
  kind: 'meals' | 'items';
  meals: { day: number; meal: string; name: string }[];
  sections: { section: string; count: number; total_kobo: number }[];
  have_options: { id: string; name: string; icon: string; photo: string | null; section: string }[];
  market_count: number;
};
export type WizardResult = {
  id: string;
  total_kobo?: number;
  full_kobo?: number;
  budget_kobo?: number | null;
  fits?: boolean;
  changes?: string[];
  item_count?: number;
  meal_count?: number;
};

/** Rounds a budget to a figure people would type: ₦1,000s, ₦10,000s or ₦100,000s. */
const nice = (kobo: number, up = false) => {
  const naira = kobo / 100;
  const step =
    naira >= 5_000_000 ? 100_000 : naira >= 500_000 ? 10_000 : naira >= 20_000 ? 1_000 : 500;
  return Math.max(step, (up ? Math.ceil : Math.round)(naira / step) * step) * 100;
};

/** A one-question-per-screen planner, like a guided quiz, that ends in a ready plan. */
export default function PlanWizard({
  template,
  title,
  prefill,
  edit,
  onBack,
  onCreated,
}: {
  template: string;
  title?: string;
  prefill?: {
    budget_kobo?: number | null;
    people?: number | null;
    rooms?: number | null;
    title?: string;
    answers?: Answers;
  };
  /** Changing the answers of an existing plan. */
  edit?: {
    planId: string;
    answers: Answers;
    budget_kobo: number | null;
    target_date: string | null;
  };
  onBack: () => void;
  onCreated: (result: WizardResult) => void;
}) {
  const { run, busy } = useApp();
  const { t, language } = useI18n();
  const draftKey = `fm-plan-draft:${template}`;
  const [resumed, setResumed] = useState(false);
  const [wizard, setWizard] = useState<any>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [budget, setBudget] = useState<number | null>(
    edit ? edit.budget_kobo : (prefill?.budget_kobo ?? null),
  );
  const [date, setDate] = useState(edit?.target_date ?? '');
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    void run(async () => {
      const w = await request('get', '/planner/templates/{template}/wizard', {
        params: { template },
        query: { lang: language } as any,
      });
      // Pick up an unfinished plan of this type, unless this is an edit or a typed request.
      const saved =
        edit || prefill?.answers
          ? null
          : await AsyncStorage.getItem(draftKey)
              .then((v) => (v ? JSON.parse(v) : null))
              .catch(() => null);
      setWizard(w);
      if (saved?.answers) {
        setAnswers({ ...w.defaults, ...saved.answers });
        setBudget(saved.budget ?? null);
        setDate(saved.date ?? '');
        setStep(Math.min(saved.step ?? 0, w.steps.length - 1));
        setResumed(true);
      } else setAnswers({ ...w.defaults, ...(prefill?.answers || {}), ...(edit?.answers || {}) });
    });
  }, [template, language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a draft so leaving half-way doesn't lose the answers.
  useEffect(() => {
    if (!wizard || edit) return;
    void AsyncStorage.setItem(draftKey, JSON.stringify({ answers, budget, date, step })).catch(
      () => {},
    );
  }, [wizard, answers, budget, date, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live estimate: refreshed (debounced) whenever an answer or the budget changes.
  const key = JSON.stringify([answers, budget]);
  useEffect(() => {
    if (!wizard) return;
    const timer = setTimeout(() => {
      void request('post', '/planner/preview', {
        body: { template, answers, budget_kobo: budget },
      })
        .then((p) => setPreview(p as Preview))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [key, wizard]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wizard) return <ActivityIndicator color={BRAND} style={{ marginTop: 40 }} />;
  const steps: any[] = wizard.steps;
  const current = steps[step];
  const last = step === steps.length - 1;
  const set = (id: string, value: any) => setAnswers((a) => ({ ...a, [id]: value }));
  const toggle = (id: string, value: string) => {
    const list: string[] = answers[id] || [];
    set(id, list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  async function finish() {
    setBuilding(true);
    const started = Date.now();
    try {
      const target_date = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
      const result = edit
        ? await request('put', '/plans/{id}/answers', {
            params: { id: edit.planId },
            body: { answers, budget_kobo: budget, target_date },
          })
        : await request('post', '/plans', {
            body: {
              template,
              title: prefill?.title || title,
              answers,
              budget_kobo: budget,
              target_date,
            },
          });
      if (!edit) await AsyncStorage.removeItem(draftKey).catch(() => {});
      // Let the checklist play out so people see what was done for them.
      await new Promise((r) => setTimeout(r, Math.max(0, 2600 - (Date.now() - started))));
      onCreated(result as WizardResult);
    } catch (e) {
      setBuilding(false);
      throw e;
    }
  }
  if (building) return <Building meals={wizard.meals} />;

  const canGo =
    !current ||
    (current.type === 'multi' && current.id !== 'extras' && current.id !== 'covering'
      ? (answers[current.id] || []).length > 0
      : current.type === 'days'
        ? (answers[current.id] || []).length > 0
        : true);
  const next = () => (last ? void run(finish) : setStep(step + 1));

  return (
    <View style={{ gap: 18 }}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => (step ? setStep(step - 1) : onBack())}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
        </View>
        <Text style={styles.count}>
          {step + 1}/{steps.length}
        </Text>
      </View>
      {resumed && (
        <View style={styles.resumed}>
          <Text style={[styles.small, { flex: 1 }]}>↺ {t('planner.resumed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void AsyncStorage.removeItem(draftKey).catch(() => {});
              setAnswers({ ...wizard.defaults });
              setBudget(prefill?.budget_kobo ?? null);
              setDate('');
              setStep(0);
              setResumed(false);
            }}
          >
            <Text style={styles.link}>{t('planner.startOver')}</Text>
          </Pressable>
        </View>
      )}
      <FadeIn key={step} style={{ gap: 6 }}>
        <Text style={styles.kicker}>{wizard.template.title}</Text>
        <Text style={styles.question}>{current.title}</Text>
        {!!current.hint && <Text style={styles.hint}>{current.hint}</Text>}
      </FadeIn>

      <FadeIn key={`body-${step}`}>
        {current.type === 'counts' && (
          <View style={{ gap: 10 }}>
            {current.counters.map((c: any) => (
              <View key={c.id} style={styles.counter}>
                <Text style={styles.counterIcon}>{c.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{c.label}</Text>
                  {!!c.hint && <Text style={styles.small}>{c.hint}</Text>}
                </View>
                <Stepper
                  value={answers[c.id] ?? c.default}
                  min={c.min}
                  max={c.max}
                  big={c.max > 100}
                  onChange={(v) => set(c.id, v)}
                />
              </View>
            ))}
          </View>
        )}

        {(current.type === 'single' || current.type === 'multi') && (
          <View style={styles.grid}>
            {current.options.map((o: any) => {
              const on =
                current.type === 'single'
                  ? answers[current.id] === o.id
                  : (answers[current.id] || []).includes(o.id);
              return (
                <PressScale
                  key={o.id}
                  accessibilityRole={current.type === 'single' ? 'radio' : 'checkbox'}
                  accessibilityState={{ checked: on }}
                  wrapStyle={styles.tileWrap}
                  style={[styles.tile, on && styles.tileOn]}
                  onPress={() =>
                    current.type === 'single' ? set(current.id, o.id) : toggle(current.id, o.id)
                  }
                >
                  {on && <Text style={styles.tick}>✓</Text>}
                  <Text style={styles.tileIcon}>{o.icon}</Text>
                  <Text style={styles.tileLabel}>{o.label}</Text>
                  {!!o.hint && <Text style={styles.small}>{o.hint}</Text>}
                </PressScale>
              );
            })}
          </View>
        )}

        {current.type === 'chips' && (
          <View style={styles.chips}>
            {current.options.map((o: any) => {
              const on = (answers[current.id] || []).includes(o.id);
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(current.id, o.id)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && { color: '#fff' }]}>
                    {o.icon} {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {current.type === 'days' && (
          <View style={styles.days}>
            {DAYS.map(([id, letter]) => {
              const on = (answers[current.id] || []).includes(id);
              return (
                <Pressable
                  key={id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={id}
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(current.id, id)}
                  style={styles.dayCol}
                >
                  <Text style={styles.dayLetter}>{letter}</Text>
                  <View style={[styles.dayDot, on && styles.dayDotOn]}>
                    {on && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {current.type === 'have' && (
          <HaveGrid
            options={preview?.have_options}
            picked={answers.have || []}
            onToggle={(id) => toggle('have', id)}
          />
        )}

        {current.type === 'quality' && (
          <View style={{ gap: 10 }}>
            {QUALITY.map((o) => {
              const on = (answers.quality || 'STANDARD') === o.id;
              return (
                <PressScale
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[styles.wide, on && styles.tileOn]}
                  onPress={() => set('quality', o.id)}
                >
                  <Text style={styles.counterIcon}>{o.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{t(o.label)}</Text>
                    <Text style={styles.small}>{t(o.hint)}</Text>
                  </View>
                  {on && <Text style={styles.tickInline}>✓</Text>}
                </PressScale>
              );
            })}
          </View>
        )}

        {current.type === 'budget' && (
          <BudgetStep preview={preview} budget={budget} meals={wizard.meals} onChange={setBudget} />
        )}

        {current.type === 'date' && <DateStep value={date} onChange={setDate} />}
      </FadeIn>

      {current.type !== 'budget' && preview && (
        <Text style={styles.running}>
          {wizard.meals
            ? `${preview.meals.filter((m) => !/Eba|Semolina/.test(m.name)).length} meals · ${preview.item_count} ingredients · about ${money(preview.total_kobo)}`
            : t('planner.soFar', { n: preview.item_count, amount: money(preview.total_kobo) })}
        </Text>
      )}
      <Button
        title={
          last
            ? busy
              ? t('planner.building')
              : edit
                ? t('planner.update')
                : t('planner.build')
            : current.type === 'have'
              ? t('planner.continueHave', { n: (answers.have || []).length })
              : current.type === 'date' && !date
                ? t('planner.skip')
                : t('planner.next')
        }
        disabled={busy || !canGo}
        onPress={next}
      />
    </View>
  );
}

function Stepper({
  value,
  min,
  max,
  big,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  big?: boolean;
  onChange: (v: number) => void;
}) {
  // Guest counts move in tens; people and rooms one at a time.
  const step = big ? 10 : 1;
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fewer"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepBtn, value <= min && { opacity: 0.35 }]}
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepBtn, styles.stepBtnOn, value >= max && { opacity: 0.35 }]}
      >
        <Text style={[styles.stepText, { color: '#fff' }]}>+</Text>
      </Pressable>
    </View>
  );
}

function HaveGrid({
  options,
  picked,
  onToggle,
}: {
  options?: Preview['have_options'];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  const [section, setSection] = useState('All');
  if (!options) return <ActivityIndicator color={BRAND} />;
  const sections = ['All', ...new Set(options.map((o) => o.section))];
  const shown = section === 'All' ? options : options.filter((o) => o.section === section);
  return (
    <View style={{ gap: 12 }}>
      {sections.length > 2 && (
        <View style={styles.chips}>
          {sections.map((x) => (
            <Pressable
              key={x}
              onPress={() => setSection(x)}
              style={[styles.chip, section === x && styles.chipOn]}
            >
              <Text style={[styles.chipText, section === x && { color: '#fff' }]}>{x}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.haveGrid}>
        {shown.map((o) => {
          const on = picked.includes(o.id);
          return (
            <Pressable
              key={o.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.name}
              onPress={() => onToggle(o.id)}
              style={[styles.haveTile, on && styles.tileOn]}
            >
              {on && <Text style={styles.tick}>✓</Text>}
              {o.photo ? (
                <Image source={{ uri: o.photo }} style={styles.havePhoto} />
              ) : (
                <Text style={{ fontSize: 30 }}>{o.icon}</Text>
              )}
              <Text numberOfLines={2} style={styles.haveLabel}>
                {o.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A draggable budget slider with live feedback, like a running tally. */
function BudgetStep({
  preview,
  budget,
  meals,
  onChange,
}: {
  preview: Preview | null;
  budget: number | null;
  meals: boolean;
  onChange: (v: number | null) => void;
}) {
  const full = preview?.full_kobo || 0;
  // The slider runs from a third of the full estimate to double it.
  const range = useMemo(() => {
    const top = nice(Math.max(full * 2, 1_000_000));
    return { min: nice(Math.max(full / 3, 100_000)), max: top };
  }, [full > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const { t } = useI18n();
  const [typing, setTyping] = useState('');
  const width = useRef(1);
  const value = budget ?? nice(full || range.max / 2);
  useEffect(() => {
    // Start just above the full estimate, so nothing is trimmed until the customer slides down.
    if (budget == null && full) onChange(nice(full, true));
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromX = (x: number) =>
    nice(range.min + Math.min(1, Math.max(0, x / width.current)) * (range.max - range.min));
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => onChange(fromX(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChange(fromX(e.nativeEvent.locationX)),
      }),
    [range.min, range.max], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const share = Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min || 1)));
  const spare = preview ? value - preview.total_kobo : 0;
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.budgetCard}>
        <Text style={styles.budgetValue}>{money(value)}</Text>
        <Text style={styles.small}>{t('planner.dragHint')}</Text>
        <View
          {...responder.panHandlers}
          onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
          style={styles.track}
          accessibilityRole="adjustable"
          accessibilityLabel="Budget"
        >
          <View style={styles.rail} pointerEvents="none" />
          <View style={[styles.trackFill, { width: `${share * 100}%` }]} pointerEvents="none" />
          <View style={[styles.thumb, { left: `${share * 100}%` }]} pointerEvents="none" />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.small}>{money(range.min)}</Text>
          <Text style={styles.small}>{money(range.max)}</Text>
        </View>
        <TextInput
          style={styles.input}
          value={typing}
          onChangeText={(v) => {
            setTyping(v);
            const n = Number(v.replace(/[^0-9]/g, ''));
            if (n > 0) onChange(n * 100);
          }}
          keyboardType="numeric"
          placeholder={t('planner.typeBudget')}
          placeholderTextColor="#8aa698"
        />
      </View>
      {preview ? (
        <View style={[styles.feedback, !preview.fits && styles.feedbackOver]}>
          <Text style={styles.label}>
            {preview.fits
              ? spare > 0
                ? `👍 ${t('planner.roomToSpare', { amount: money(spare) })}`
                : `👍 ${t('planner.onBudget')}`
              : `⚠️ ${t('planner.short', { amount: money(preview.total_kobo - value) })}`}
          </Text>
          <Text style={styles.small}>
            {preview.fits && preview.full_kobo > value
              ? `Your full list is about ${money(preview.full_kobo)}. We’ll fit it to ${money(value)}: `
              : `Your list comes to about ${money(preview.total_kobo)}. `}
            {preview.changes.join('; ')}
          </Text>
          <View style={styles.stats}>
            <Stat value={money(preview.total_kobo)} label={t('planner.estimated')} />
            <Stat
              value={money(preview.per_serving_kobo)}
              label={meals ? t('planner.perPlate') : t('planner.perPerson')}
            />
            <Stat
              value={String(meals ? preview.servings : preview.item_count)}
              label={meals ? t('planner.plates') : t('planner.items')}
            />
          </View>
          {preview.market_count > 0 && (
            <Text style={styles.small}>
              🏷️ {t('planner.marketPrices', { n: preview.market_count })}
            </Text>
          )}
        </View>
      ) : (
        <ActivityIndicator color={BRAND} />
      )}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.small}>{label.toUpperCase()}</Text>
    </View>
  );
}

function DateStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const quick: [string, number][] = [
    ['In 2 weeks', 14],
    ['In a month', 30],
    ['In 3 months', 90],
    ['In 6 months', 180],
  ];
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.chips}>
        {quick.map(([label, d]) => (
          <Pressable
            key={label}
            onPress={() => onChange(inDays(d))}
            style={[styles.chip, value === inDays(d) && styles.chipOn]}
          >
            <Text style={[styles.chipText, value === inDays(d) && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#8aa698"
        accessibilityLabel="Date"
      />
    </View>
  );
}

/** "Finalising your plan" checklist shown while the plan is built. */
function Building({ meals }: { meals: boolean }) {
  const { t } = useI18n();
  const lines = meals
    ? [
        'Checking your kitchen and dislikes…',
        'Choosing your recipes…',
        'Costing your basket…',
        'Checking the budget…',
        'Writing your grocery list…',
      ]
    : [
        'Sizing everything for you…',
        'Leaving out what you already have…',
        'Checking prices with sellers…',
        'Fitting your budget…',
        'Finishing your plan…',
      ];
  const [done, setDone] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDone((d) => Math.min(lines.length, d + 1)), 500);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <View style={styles.building}>
      <Text style={{ fontSize: 54 }}>{meals ? '🍲' : '🛍️'}</Text>
      <Text style={styles.question}>{t('planner.building')}</Text>
      <View style={{ gap: 10, alignSelf: 'stretch' }}>
        {lines.map((l, i) => (
          <View key={l} style={styles.buildRow}>
            <View style={[styles.buildDot, i < done && styles.dayDotOn]}>
              {i < done && <Text style={{ color: '#fff', fontSize: 11 }}>✓</Text>}
            </View>
            <Text style={[styles.small, i < done && { color: INK }]}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { fontSize: 32, color: INK, lineHeight: 34, paddingHorizontal: 4 },
  progress: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#dcefe4', overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: BRAND, borderRadius: 3 },
  count: { fontSize: 12, color: MUTED, fontWeight: '600' },
  kicker: { fontSize: 11, letterSpacing: 1.2, color: MUTED, textTransform: 'uppercase' },
  question: { fontSize: 26, lineHeight: 32, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  hint: { fontSize: 14, lineHeight: 20, color: MUTED },
  label: { fontSize: 15, fontWeight: '700', color: INK },
  small: { fontSize: 12, lineHeight: 17, color: MUTED },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dcefe4',
  },
  counterIcon: { fontSize: 30 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cfe6da',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  stepBtnOn: { backgroundColor: BRAND, borderColor: BRAND },
  stepText: { fontSize: 20, fontWeight: '700', color: INK, lineHeight: 22 },
  stepValue: { minWidth: 34, textAlign: 'center', fontSize: 20, fontWeight: '800', color: INK },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileWrap: { width: '48%', flexGrow: 1 },
  tile: {
    minHeight: 104,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#dcefe4',
    gap: 4,
  },
  tileOn: { borderColor: BRAND, backgroundColor: SOFT },
  tileIcon: { fontSize: 30 },
  tileLabel: { fontSize: 14, fontWeight: '700', color: INK },
  tick: {
    position: 'absolute',
    top: 8,
    right: 10,
    color: '#fff',
    backgroundColor: BRAND,
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 20,
    overflow: 'hidden',
    fontWeight: '800',
  },
  tickInline: { color: BRAND, fontSize: 20, fontWeight: '800' },
  wide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#dcefe4',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cfe6da',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipText: { fontSize: 13, color: INK, fontWeight: '600' },
  days: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  dayCol: { alignItems: 'center', gap: 8 },
  dayLetter: { fontSize: 13, fontWeight: '700', color: MUTED },
  dayDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#cfe6da',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  dayDotOn: { backgroundColor: BRAND, borderColor: BRAND },
  haveGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  haveTile: {
    width: '31%',
    flexGrow: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    gap: 4,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#dcefe4',
  },
  haveLabel: { fontSize: 11, textAlign: 'center', color: INK, fontWeight: '600' },
  running: { fontSize: 12, color: MUTED, textAlign: 'center' },
  budgetCard: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dcefe4',
    gap: 12,
    alignItems: 'stretch',
  },
  budgetValue: { fontSize: 40, fontWeight: '800', color: INK, textAlign: 'center' },
  track: {
    height: 36,
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 14,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#dcefe4',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 14,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND,
  },
  thumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    top: 4,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: BRAND,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  resumed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: SOFT,
  },
  link: { fontSize: 13, color: BRAND, fontWeight: '700' },
  havePhoto: { width: 46, height: 46, borderRadius: 10 },
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 10,
    backgroundColor: '#fff',
    fontSize: 15,
    color: INK,
  },
  feedback: { padding: 16, borderRadius: 16, backgroundColor: SOFT, gap: 8 },
  feedbackOver: { backgroundColor: '#fbece7' },
  stats: { flexDirection: 'row', paddingTop: 6 },
  statValue: { fontSize: 16, fontWeight: '800', color: INK },
  building: { alignItems: 'center', gap: 16, paddingVertical: 30 },
  buildRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buildDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cfe6da',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
