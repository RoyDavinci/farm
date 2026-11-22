import { money } from '@ahia/shared';
import { BadgeCheck, Banknote, Megaphone, RefreshCw, Store, Truck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request, upload } from '../api';
import { Badge, Empty, Stat } from '../ui';

const naira = (kobo: number) => money(Number(kobo || 0));
const toKobo = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, '') || 0) * 100);
const list = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const { setError } = useAdmin();
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(
    () =>
      load()
        .then(setData)
        .catch((e) => setError(e.message)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  useEffect(() => void reload(), [reload]);
  return [data, reload] as const;
}

// ---------------------------------------------------------------- Verifications
const statusText: Record<string, string> = {
  PENDING: 'Waiting for review',
  INFO_REQUESTED: 'More information requested',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Expired',
};
const badgeFor = (s: string) =>
  ({ VERIFIED: 'COMPLETED', REJECTED: 'DECLINED', SUSPENDED: 'CANCELLED', EXPIRED: 'EXPIRED' })[
    s
  ] || s;

/** Business verification queue: check details and documents, then decide with a reason. */
export function VerificationsPage() {
  const { busy, action } = useAdmin();
  const [filter, setFilter] = useState('QUEUE');
  const [rows, reload] = useLoad(
    () => request('get', '/admin/verifications', { query: { status: filter as any } }),
    [filter],
  );
  const decide = (
    seller: any,
    status: 'VERIFIED' | 'REJECTED' | 'INFO_REQUESTED' | 'SUSPENDED',
  ) => {
    const note = window.prompt(
      {
        VERIFIED:
          'What did you check? For example: CAC number matches, phone answered, address visited. (10+ characters)',
        REJECTED: 'Why can’t this business be verified? The seller sees this. (10+ characters)',
        INFO_REQUESTED: 'What else is needed? The seller sees this. (10+ characters)',
        SUSPENDED: 'Why is the badge suspended? The seller sees this. (10+ characters)',
      }[status],
    );
    if (!note) return;
    const months =
      status === 'VERIFIED' ? Number(window.prompt('Valid for how many months?', '12') || 12) : 12;
    void action(async () => {
      await request('post', '/admin/verifications/{sellerId}', {
        params: { sellerId: seller.seller_id },
        body: { status, note, valid_months: months },
      });
      await reload();
    }, `Business marked ${statusText[status].toLowerCase()}.`);
  };
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>
            <BadgeCheck size={18} /> Business verification
          </h2>
          <p>
            Verification is a check of identity, contact details and location. It is never granted
            for payment and doesn’t guarantee every product.
          </p>
        </div>
        <div className="row-actions">
          {['QUEUE', 'VERIFIED', 'SUSPENDED', 'EXPIRED', 'REJECTED', 'ALL'].map((f) => (
            <button
              key={f}
              className={filter === f ? 'compact' : 'secondary compact'}
              onClick={() => setFilter(f)}
            >
              {f === 'QUEUE' ? 'To review' : f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Details given</th>
              <th>Documents</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r: any) => {
              const d = r.verification_details || {};
              return (
                <tr key={r.seller_id}>
                  <td>
                    <b>{r.business_name}</b>
                    <small>
                      {r.business_type} · {r.area}, {r.city}
                    </small>
                    <small>
                      {r.email} · {r.phone}
                    </small>
                  </td>
                  <td>
                    <b>{d.legal_name || '—'}</b>
                    <small>
                      {d.registration_number ? `CAC ${d.registration_number}` : 'Not registered'}
                    </small>
                    <small>
                      {d.contact_person} · {d.contact_phone}
                    </small>
                    <small>{d.business_address}</small>
                  </td>
                  <td>
                    {r.documents.length ? (
                      r.documents.map((doc: any) => (
                        <small key={doc.id}>
                          {doc.kind.replaceAll('_', ' ')} · {doc.status.toLowerCase()}
                        </small>
                      ))
                    ) : (
                      <small>None uploaded</small>
                    )}
                    <small>Open and accept documents on the Sellers page.</small>
                  </td>
                  <td>
                    <Badge status={badgeFor(r.verification_status)} />
                    <small>{statusText[r.verification_status]}</small>
                    {r.verification_expires_at && (
                      <small>
                        Review by {new Date(r.verification_expires_at).toLocaleDateString()}
                      </small>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      {['PENDING', 'INFO_REQUESTED', 'SUSPENDED', 'EXPIRED'].includes(
                        r.verification_status,
                      ) && (
                        <button
                          className="compact"
                          disabled={busy}
                          onClick={() => decide(r, 'VERIFIED')}
                        >
                          Verify
                        </button>
                      )}
                      {r.verification_status === 'PENDING' && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => decide(r, 'INFO_REQUESTED')}
                        >
                          Ask for more
                        </button>
                      )}
                      {['PENDING', 'INFO_REQUESTED'].includes(r.verification_status) && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => decide(r, 'REJECTED')}
                        >
                          Reject
                        </button>
                      )}
                      {r.verification_status === 'VERIFIED' && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => decide(r, 'SUSPENDED')}
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows && !rows.length && (
        <Empty
          title="Nothing to review"
          text="Sellers apply for verification from their shop settings in the app."
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Revenue
const switchText: Record<string, [string, string]> = {
  transaction_commission: [
    'Transaction commission',
    'Charged when an order completes. Off = 0% on new orders.',
  ],
  delivery_commission: ['Delivery commission', 'Ahia’s share of each completed delivery fare.'],
  sponsored_products: [
    'Sponsored products',
    'Sellers can promote products; sponsored results show in search.',
  ],
  featured_sellers: ['Featured sellers', 'Sellers can feature their shop on Home.'],
  local_ads: ['Local business adverts', 'Paid adverts from businesses, shown on Home.'],
};

/** Income by stream, owner switches for each paid feature, and promotion package prices. */
export function RevenuePage() {
  const { busy, action } = useAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [report, reload] = useLoad(
    () => request('get', '/admin/revenue/report', { query: { from, to } }),
    [from, to],
  );
  const [packages, reloadPackages] = useLoad(() => request('get', '/admin/promotion-packages'));
  const peak = Math.max(1, ...(report?.series || []).map((d: any) => d.amount_kobo));
  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ['Stream', 'Amount (NGN)', 'Entries', 'Share %'],
      ...report.streams.map((s: any) => [
        s.label,
        (s.amount_kobo / 100).toFixed(2),
        s.entries,
        s.share,
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ahia-revenue-${from}-to-${to}.csv`;
    a.click();
  };
  return (
    <>
      <div className="stats">
        <Stat
          label="Income"
          value={naira(report?.total_kobo || 0)}
          detail={`${from} to ${to}`}
          icon={<Banknote />}
        />
        <Stat
          label="Completed orders"
          value={report?.orders.completed ?? '—'}
          detail={`${naira(report?.orders.gross_kobo || 0)} sold`}
          icon={<Store />}
        />
        <Stat
          label="Cancelled or declined"
          value={report?.orders.cancelled ?? '—'}
          detail="Orders in the same period"
          icon={<RefreshCw />}
        />
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Income by stream</h2>
            <p>{report?.note}</p>
          </div>
          <div className="row-actions">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
            <button className="secondary compact" onClick={() => void reload()}>
              Refresh
            </button>
            <button className="secondary compact" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="planner-chart" role="img" aria-label="Income per day">
          {(report?.series || []).map((d: any) => (
            <div key={d.day} className="planner-bar" title={`${d.day}: ${naira(d.amount_kobo)}`}>
              <span style={{ height: `${(Math.max(0, d.amount_kobo) / peak) * 100}%` }} />
            </div>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>Stream</th>
              <th>Income</th>
              <th>Entries</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {(report?.streams || []).map((s: any) => (
              <tr key={s.stream}>
                <td>
                  <b>{s.label}</b>
                </td>
                <td>{naira(s.amount_kobo)}</td>
                <td>{s.entries}</td>
                <td>
                  <div className="share-bar">
                    <span style={{ width: `${Math.max(0, s.share)}%` }} />
                  </div>
                  <small>{s.share}%</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {report && !report.streams.length && (
          <Empty
            title="No income yet"
            text="Income appears here as orders complete and promotions are bought."
          />
        )}
      </section>
      <section className="card">
        <h2>Revenue switches</h2>
        <p>Pause or start each way Ahia earns. Basic listing and browsing stay free either way.</p>
        <div className="switch-grid">
          {report &&
            Object.entries(switchText).map(([key, [title, help]]) => (
              <label key={key} className="switch-row">
                <input
                  type="checkbox"
                  checked={(report.switches as any)[key]}
                  disabled={busy}
                  onChange={(e) =>
                    void action(
                      async () => {
                        await request('put', '/admin/revenue/switches', {
                          body: { ...report.switches, [key]: e.target.checked },
                        });
                        await reload();
                      },
                      `${title} ${e.target.checked ? 'switched on' : 'paused'}.`,
                    )
                  }
                />
                <span>
                  <b>{title}</b>
                  <small>{help}</small>
                </span>
              </label>
            ))}
        </div>
        <p>
          Set a different commission for a category (for example an introductory rate) on the
          Catalogue page.
        </p>
      </section>
      <section className="card">
        <h2>Promotion packages</h2>
        <p>Fixed-length packages sellers can buy from their sales proceeds.</p>
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>For</th>
              <th>Days</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(packages || []).map((p: any) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  {!p.active && <small>Hidden</small>}
                </td>
                <td>{p.kind === 'PRODUCT' ? 'Sponsored product' : 'Featured shop'}</td>
                <td>{p.days}</td>
                <td>{naira(p.price_kobo)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        const price = window.prompt(
                          `New price for ${p.name} (₦)`,
                          String(p.price_kobo / 100),
                        );
                        if (price)
                          void action(async () => {
                            await request('put', '/admin/promotion-packages/{id}', {
                              params: { id: p.id },
                              body: {
                                kind: p.kind,
                                name: p.name,
                                days: p.days,
                                price_kobo: toKobo(price),
                                active: p.active,
                              },
                            });
                            await reloadPackages();
                          }, 'Price updated.');
                      }}
                    >
                      Change price
                    </button>
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          async () => {
                            await request('put', '/admin/promotion-packages/{id}', {
                              params: { id: p.id },
                              body: {
                                kind: p.kind,
                                name: p.name,
                                days: p.days,
                                price_kobo: p.price_kobo,
                                active: !p.active,
                              },
                            });
                            await reloadPackages();
                          },
                          p.active ? 'Package hidden.' : 'Package offered again.',
                        )
                      }
                    >
                      {p.active ? 'Hide' : 'Offer'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Advertising
const blankAd = {
  advertiser: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  title: '',
  body: '',
  link_url: '',
  image_url: '',
  cta: 'Learn more',
  states: '',
  lgas: '',
  categories: '',
  starts_at: new Date().toISOString().slice(0, 10),
  ends_at: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  price: '',
};

/** Adverts from local businesses (paid by transfer, recorded here) and featured shops. */
export function AdvertisingPage() {
  const { busy, action } = useAdmin();
  const [ads, reloadAds] = useLoad(() => request('get', '/admin/ads'));
  const [featured, reloadFeatured] = useLoad(() => request('get', '/admin/featured-sellers'));
  const [form, setForm] = useState<any>(null);
  const field = (key: string, label: string, props: any = {}) => (
    <label>
      {label}
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </label>
  );
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>
              <Megaphone size={18} /> Local business adverts
            </h2>
            <p>
              For supermarkets, restaurants, brands and other businesses. Adverts are labelled
              “Advertisement”, go live only once paid, and can target states, LGAs and categories.
            </p>
          </div>
          <button onClick={() => setForm({ ...blankAd })}>New campaign</button>
        </div>
        {form && (
          <div className="settings-card form-grid">
            {field('advertiser', 'Advertiser')}
            {field('contact_name', 'Contact person')}
            {field('contact_phone', 'Contact phone')}
            {field('contact_email', 'Contact email')}
            {field('title', 'Headline', { maxLength: 80 })}
            {field('body', 'Text', { maxLength: 240 })}
            {field('cta', 'Button text', { maxLength: 24 })}
            {field('link_url', 'Link (https://…)')}
            {field('image_url', 'Image link (optional)')}
            {field('states', 'States (comma separated, empty = all)')}
            {field('lgas', 'LGAs (comma separated, empty = all)')}
            {field('categories', 'Categories (comma separated, empty = all)')}
            {field('starts_at', 'Starts', { type: 'date' })}
            {field('ends_at', 'Ends', { type: 'date' })}
            {field('price', 'Price (₦)', { inputMode: 'numeric' })}
            <div className="row-actions">
              <button
                disabled={busy || !form.advertiser || !form.title || !form.price}
                onClick={() =>
                  void action(async () => {
                    const body = {
                      advertiser: form.advertiser,
                      contact_name: form.contact_name,
                      contact_phone: form.contact_phone,
                      contact_email: form.contact_email,
                      title: form.title,
                      body: form.body,
                      cta: form.cta || 'Learn more',
                      link_url: form.link_url || null,
                      image_url: form.image_url || null,
                      states: list(form.states),
                      lgas: list(form.lgas),
                      categories: list(form.categories),
                      starts_at: new Date(`${form.starts_at}T00:00:00+01:00`).toISOString(),
                      ends_at: new Date(`${form.ends_at}T23:59:00+01:00`).toISOString(),
                      price_kobo: toKobo(form.price),
                    };
                    if (form.id)
                      await request('put', '/admin/ads/{id}', { params: { id: form.id }, body });
                    else await request('post', '/admin/ads', { body });
                    setForm(null);
                    await reloadAds();
                  }, 'Campaign saved. Record the payment, then make it live.')
                }
              >
                Save campaign
              </button>
              <button className="secondary" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Targeting and dates</th>
                <th>Payment</th>
                <th>Results</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(ads || []).map((a: any) => (
                <tr key={a.id}>
                  <td>
                    {a.image_url && <img className="ad-thumb" src={a.image_url} alt="" />}
                    <b>{a.title}</b>
                    <small>{a.advertiser}</small>
                    <small>{a.contact_phone || a.contact_email}</small>
                  </td>
                  <td>
                    <small>{a.states.length ? a.states.join(', ') : 'All states'}</small>
                    {!!a.lgas.length && <small>{a.lgas.join(', ')}</small>}
                    {!!a.categories.length && <small>{a.categories.join(', ')}</small>}
                    <small>
                      {new Date(a.starts_at).toLocaleDateString()} –{' '}
                      {new Date(a.ends_at).toLocaleDateString()}
                    </small>
                  </td>
                  <td>
                    <b>
                      {naira(a.paid_kobo)} of {naira(a.price_kobo)}
                    </b>
                    <small>{a.paid_kobo >= a.price_kobo ? 'Paid' : 'Awaiting payment'}</small>
                  </td>
                  <td>
                    {a.impressions.toLocaleString()} views
                    <small>
                      {a.clicks} clicks · {a.click_rate}%
                    </small>
                  </td>
                  <td>
                    <Badge status={a.live ? 'ACTIVE' : a.status} />
                  </td>
                  <td>
                    <div className="row-actions">
                      {a.paid_kobo < a.price_kobo && (
                        <button
                          className="compact"
                          disabled={busy}
                          onClick={() => {
                            const amount = window.prompt(
                              'Amount received (₦)',
                              String((a.price_kobo - a.paid_kobo) / 100),
                            );
                            const reference =
                              amount && window.prompt('Transfer or invoice reference');
                            if (amount && reference)
                              void action(async () => {
                                await request('post', '/admin/ads/{id}/payments', {
                                  params: { id: a.id },
                                  body: { amount_kobo: toKobo(amount), reference },
                                });
                                await reloadAds();
                              }, 'Payment recorded as advertising income.');
                          }}
                        >
                          Record payment
                        </button>
                      )}
                      {a.status !== 'ACTIVE' && a.status !== 'ENDED' && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await request('post', '/admin/ads/{id}/status', {
                                params: { id: a.id },
                                body: { status: 'ACTIVE' },
                              });
                              await reloadAds();
                            }, 'Campaign is live.')
                          }
                        >
                          Go live
                        </button>
                      )}
                      {a.status === 'ACTIVE' && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await request('post', '/admin/ads/{id}/status', {
                                params: { id: a.id },
                                body: { status: 'PAUSED' },
                              });
                              await reloadAds();
                            }, 'Campaign paused.')
                          }
                        >
                          Pause
                        </button>
                      )}
                      <label className="secondary compact file-button">
                        {a.image_url ? 'Change image' : 'Upload image'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file)
                              void action(async () => {
                                await upload(`/admin/ads/${a.id}/image`, 'image', file);
                                await reloadAds();
                              }, 'Image uploaded. Wide banners (2:1) look best.');
                          }}
                        />
                      </label>
                      <button
                        className="secondary compact"
                        onClick={() =>
                          setForm({
                            ...a,
                            link_url: a.link_url || '',
                            image_url: a.image_url || '',
                            states: a.states.join(', '),
                            lgas: a.lgas.join(', '),
                            categories: a.categories.join(', '),
                            starts_at: a.starts_at.slice(0, 10),
                            ends_at: a.ends_at.slice(0, 10),
                            price: String(a.price_kobo / 100),
                          })
                        }
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ads && !ads.length && (
          <Empty
            title="No campaigns yet"
            text="Create a campaign for a business that wants to reach local buyers."
          />
        )}
      </section>
      <section className="card">
        <h2>Featured shops</h2>
        <p>
          Sellers feature their shop on Home with a package paid from their proceeds. Featured is
          not Verified.
        </p>
        <table>
          <thead>
            <tr>
              <th>Shop</th>
              <th>Package</th>
              <th>Dates</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(featured || []).map((f: any) => (
              <tr key={f.id}>
                <td>
                  <b>{f.business_name}</b>
                </td>
                <td>
                  {f.package_name || `${f.days} days`}
                  <small>{naira(f.fee_kobo)}</small>
                </td>
                <td>
                  <small>
                    {new Date(f.starts_at).toLocaleDateString()} –{' '}
                    {new Date(f.ends_at).toLocaleDateString()}
                  </small>
                </td>
                <td>
                  <Badge
                    status={
                      f.running ? 'ACTIVE' : f.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED'
                    }
                  />
                  {f.refund_kobo > 0 && <small>Refunded {naira(f.refund_kobo)}</small>}
                </td>
                <td>
                  {f.running && (
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          'Why stop this featured shop? The seller sees this.',
                        );
                        if (reason)
                          void action(async () => {
                            await request('post', '/admin/featured-sellers/{id}/cancel', {
                              params: { id: f.id },
                              body: { reason },
                            });
                            await reloadFeatured();
                          }, 'Featured shop stopped; unused days refunded.');
                      }}
                    >
                      Stop
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {featured && !featured.length && (
          <Empty title="No featured shops" text="Sellers buy these from Sell → Promote my shop." />
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Delivery partners
const blankPartner = {
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  states: '',
  rate: '10',
  notes: '',
  status: 'ACTIVE',
};

/** Logistics companies whose riders deliver for Ahia, at an agreed commission. */
export function DeliveryPartnersPage() {
  const { busy, action } = useAdmin();
  const [partners, reload] = useLoad(() => request('get', '/admin/delivery-partners'));
  const [form, setForm] = useState<any>(null);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>
            <Truck size={18} /> Delivery partner companies
          </h2>
          <p>
            Ahia keeps the agreed share of each delivery completed by a partner’s riders.
            Independent riders use the default delivery commission from Settings.
          </p>
        </div>
        <button onClick={() => setForm({ ...blankPartner })}>Add partner</button>
      </div>
      {form && (
        <div className="settings-card form-grid">
          {(['name', 'contact_name', 'phone', 'email', 'states', 'rate', 'notes'] as const).map(
            (k) => (
              <label key={k}>
                {
                  {
                    name: 'Company',
                    contact_name: 'Contact person',
                    phone: 'Phone',
                    email: 'Email',
                    states: 'States covered (comma separated)',
                    rate: 'Ahia’s share of each fare (%)',
                    notes: 'Notes',
                  }[k]
                }
                <input
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ),
          )}
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
            </select>
          </label>
          <div className="row-actions">
            <button
              disabled={busy || form.name.trim().length < 2}
              onClick={() =>
                void action(async () => {
                  const body = {
                    name: form.name,
                    contact_name: form.contact_name,
                    phone: form.phone,
                    email: form.email,
                    states: list(form.states),
                    commission_bps: Math.round(Number(form.rate || 0) * 100),
                    status: form.status,
                    notes: form.notes,
                  };
                  if (form.id)
                    await request('put', '/admin/delivery-partners/{id}', {
                      params: { id: form.id },
                      body,
                    });
                  else await request('post', '/admin/delivery-partners', { body });
                  setForm(null);
                  await reload();
                }, 'Partner saved.')
              }
            >
              Save partner
            </button>
            <button className="secondary" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Rate</th>
              <th>Riders</th>
              <th>Deliveries</th>
              <th>Ahia earned</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(partners || []).map((p: any) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <small>
                    {p.contact_name} {p.phone}
                  </small>
                  <small>{p.states.length ? p.states.join(', ') : 'All states'}</small>
                  {p.status === 'PAUSED' && <small>Paused</small>}
                </td>
                <td>{p.commission_bps / 100}%</td>
                <td>
                  {p.drivers}
                  {p.riders.map((r: any) => (
                    <small key={r.driver_id}>
                      {r.name} · {r.vehicle_type}
                    </small>
                  ))}
                </td>
                <td>{p.deliveries}</td>
                <td>{naira(p.commission_kobo)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        const id = window.prompt('Rider’s user ID to add (from the Drivers page)');
                        if (id)
                          void action(async () => {
                            await request('post', '/admin/delivery-partners/{id}/drivers', {
                              params: { id: p.id },
                              body: { driver_id: id.trim(), remove: false },
                            });
                            await reload();
                          }, 'Rider added to partner.');
                      }}
                    >
                      Add rider
                    </button>
                    {p.riders.map((r: any) => (
                      <button
                        key={r.driver_id}
                        className="secondary compact"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await request('post', '/admin/delivery-partners/{id}/drivers', {
                              params: { id: p.id },
                              body: { driver_id: r.driver_id, remove: true },
                            });
                            await reload();
                          }, 'Rider removed.')
                        }
                      >
                        Remove {r.name}
                      </button>
                    ))}
                    <button
                      className="secondary compact"
                      onClick={() =>
                        setForm({
                          ...p,
                          states: p.states.join(', '),
                          rate: String(p.commission_bps / 100),
                        })
                      }
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {partners && !partners.length && (
        <Empty
          title="No partners yet"
          text="Add a logistics company, agree its rate, then attach its riders."
        />
      )}
    </section>
  );
}
