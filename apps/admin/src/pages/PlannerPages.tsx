import { money } from '@ahia/shared';
import {
  ClipboardList,
  HeartPulse,
  RefreshCw,
  ShoppingCart,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Empty, Stat } from '../ui';

/** Aggregate Smart Planner usage: plans, conversion, budgets, recipes and diet (masked). */
export function PlannerUsagePage() {
  const { setError } = useAdmin();
  const [data, setData] = useState<any>(null);
  const load = useCallback(
    () =>
      request('get', '/admin/planner/usage')
        .then(setData)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => void load(), [load]);
  if (!data) return <section className="card">Loading planner usage…</section>;
  const peak = Math.max(1, ...data.daily.map((d: any) => d.plans));
  return (
    <>
      <div className="stats">
        <Stat
          label="Plans created"
          value={data.plans.total.toLocaleString()}
          detail={`${data.plans.last30} in the last 30 days · ${data.plans.planners} customers`}
          icon={<ClipboardList />}
        />
        <Stat
          label="Plan to order"
          value={`${data.conversion.plan_to_order_rate}%`}
          detail={`${data.conversion.plans_with_orders} plans led to orders · ${data.conversion.plans_with_cart} have items in a cart`}
          icon={<ShoppingCart />}
        />
        <Stat
          label="Confirmed plan spending"
          value={money(data.conversion.confirmed_kobo)}
          detail={`${data.conversion.orders} orders · average ${money(data.conversion.average_order_kobo)}`}
          icon={<Target />}
        />
        <Stat
          label="Open allergen reports"
          value={data.allergen_reports.open}
          detail={
            data.allergen_reports.urgent
              ? `${data.allergen_reports.urgent} reported reactions need attention`
              : `Usually closed within ${data.allergen_reports.hours_to_close || '—'} hours`
          }
          icon={<TriangleAlert />}
        />
      </div>
      <div className="overview-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>New plans, last 14 days</h2>
              <p>{data.plans.repeat_planners} customers have made more than one plan</p>
            </div>
            <button className="secondary compact" onClick={() => void load()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="planner-chart" role="img" aria-label="Plans created per day">
            {data.daily.map((d: any) => (
              <div key={d.day} className="planner-bar" title={`${d.day}: ${d.plans} plans`}>
                <span style={{ height: `${(d.plans / peak) * 100}%` }} />
                <small>{d.day.slice(8)}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Plan types</h2>
              <p>{data.plans.completion_rate}% of plans marked done</p>
            </div>
          </div>
          {!data.by_template.length ? (
            <Empty
              title="No plans yet"
              text="Plan types appear here once customers start planning."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Plans</th>
                  <th>Done</th>
                </tr>
              </thead>
              <tbody>
                {data.by_template.map((t: any) => (
                  <tr key={t.template || t.kind}>
                    <td>
                      <b>{t.title}</b>
                    </td>
                    <td>{t.plans}</td>
                    <td>{t.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <section className="card">
        <div className="settings-card">
          <h3>Items and products</h3>
          <div className="metrics">
            <Metric label="Plan items" value={data.items.total} />
            <Metric label="Matched to a product" value={`${data.items.linked_rate}%`} />
            <Metric label="Bought" value={data.items.purchased} />
            <Metric label="Already owned" value={data.items.owned} />
            <Metric label="Not needed" value={data.items.not_needed} />
            <Metric label="From recipes" value={data.items.from_recipes} />
          </div>
        </div>
        <div className="settings-card">
          <h3>Budgets</h3>
          <div className="metrics">
            <Metric label="Plans with a budget" value={data.budgets.with_budget} />
            <Metric label="Spending within budget" value={data.budgets.within_budget} />
            <Metric label="Budget adherence" value={`${data.budgets.adherence_rate}%`} />
            <Metric label="Completed orders" value={data.conversion.completed_orders} />
          </div>
        </div>
        <div className="settings-card">
          <h3>Most planned recipes</h3>
          {!data.top_recipes.length ? (
            <p>No meal plans yet.</p>
          ) : (
            <div className="metrics">
              {data.top_recipes.map((r: any) => (
                <Metric
                  key={r.recipe}
                  label={r.name}
                  value={`${r.meals} meals · ${r.servings} servings`}
                />
              ))}
            </div>
          )}
        </div>
        <div className="settings-card">
          <h3>
            <HeartPulse size={16} /> Diet and allergy profiles
          </h3>
          <div className="metrics">
            <Metric label="Profiles" value={data.diet.profiles} />
            <Metric label="With allergies" value={data.diet.with_allergies} />
            <Metric label="With a diet" value={data.diet.with_diet} />
            {data.diet.allergens.map((a: any) => (
              <Metric key={a.allergen} label={a.allergen} value={a.profiles} />
            ))}
          </div>
          <p>{data.privacy}</p>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
    </div>
  );
}

const issueLabel: Record<string, string> = {
  MISSING: 'Information missing',
  INCORRECT: 'Information wrong',
  REACTION: 'Reported reaction',
  OTHER: 'Other',
};

/** Buyer reports of missing or wrong allergen information, urgent reactions first. */
export function AllergenReportsPage() {
  const { busy, action, setError } = useAdmin();
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN');
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(
    () =>
      request('get', '/admin/allergen-reports', { query: { status: 'ALL' } })
        .then((all) =>
          setRows(
            status === 'OPEN'
              ? all.filter((r: any) => ['OPEN', 'REVIEWING'].includes(r.status))
              : all,
          ),
        )
        .catch((e) => setError(e.message)),
    [setError, status],
  );
  useEffect(() => void load(), [load]);
  const review = (r: any, next: 'REVIEWING' | 'RESOLVED' | 'DISMISSED') => {
    const resolution = window.prompt(
      next === 'REVIEWING'
        ? 'What are you checking, and with whom? (at least 10 characters)'
        : next === 'RESOLVED'
          ? 'What was done? For example: seller corrected the label, listing paused. The reporter sees this. (at least 10 characters)'
          : 'Why is no action needed? The reporter sees this. (at least 10 characters)',
    );
    if (resolution)
      void action(async () => {
        await request('post', '/admin/allergen-reports/{id}/review', {
          params: { id: r.id },
          body: { status: next, resolution },
        });
        await load();
      }, 'Report updated.');
  };
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Allergen reports</h2>
          <p>
            Check each report with the seller. Pause a listing from the Listings page if its
            information could put someone at risk.
          </p>
        </div>
        <div className="row-actions">
          <button
            className={status === 'OPEN' ? 'compact' : 'secondary compact'}
            onClick={() => setStatus('OPEN')}
          >
            Open
          </button>
          <button
            className={status === 'ALL' ? 'compact' : 'secondary compact'}
            onClick={() => setStatus('ALL')}
          >
            All
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Report</th>
              <th>Product or recipe</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.urgent ? 'urgent-row' : undefined}>
                <td>
                  <b>
                    {r.urgent && '⚠️ '}
                    {issueLabel[r.issue]}
                  </b>
                  <small>
                    {r.reporter_name} · {new Date(r.created_at).toLocaleString()}
                  </small>
                  <p className="report-text">{r.details}</p>
                  {!!r.allergen_labels.length && (
                    <small>Allergens: {r.allergen_labels.join(', ')}</small>
                  )}
                </td>
                <td>
                  {r.listing_id ? (
                    <>
                      <b>{r.listing_title || 'Removed listing'}</b>
                      <small>
                        {r.business_name} · {r.category}
                      </small>
                    </>
                  ) : (
                    <>
                      <b>{r.recipe_name}</b>
                      <small>Recipe library</small>
                    </>
                  )}
                </td>
                <td>
                  <Badge
                    status={
                      r.status === 'RESOLVED'
                        ? 'COMPLETED'
                        : r.status === 'DISMISSED'
                          ? 'DECLINED'
                          : r.status
                    }
                  />
                  {r.resolution && <small>{r.resolution}</small>}
                  {r.reviewer_name && <small>by {r.reviewer_name}</small>}
                </td>
                <td>
                  {['OPEN', 'REVIEWING'].includes(r.status) && (
                    <div className="row-actions">
                      {r.status === 'OPEN' && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => review(r, 'REVIEWING')}
                        >
                          Start review
                        </button>
                      )}
                      <button
                        className="compact"
                        disabled={busy}
                        onClick={() => review(r, 'RESOLVED')}
                      >
                        Resolve
                      </button>
                      <button
                        className="secondary compact"
                        disabled={busy}
                        onClick={() => review(r, 'DISMISSED')}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Empty
          title={status === 'OPEN' ? 'No open allergen reports' : 'No allergen reports yet'}
          text="Buyers can report missing or wrong allergen information from a product or recipe."
        />
      )}
    </section>
  );
}
