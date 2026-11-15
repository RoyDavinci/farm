import { money, statusLabel } from '@farmers-market/shared';
import { useEffect, useState } from 'react';
import { request } from './api';
export default function CommercePanel({
  page,
}: {
  page: 'Markets' | 'Disputes' | 'Reconciliation';
}) {
  const [rows, setRows] = useState<any[]>([]),
    [exceptions, setExceptions] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [resolution, setResolution] = useState(''),
    [refund, setRefund] = useState('0'),
    [restock, setRestock] = useState(false);
  const endpoint =
    page === 'Markets'
      ? '/markets'
      : page === 'Disputes'
        ? '/admin/disputes'
        : '/admin/reconciliation';
  async function load() {
    if (page === 'Reconciliation') {
      const data = await request('get', '/admin/reconciliation');
      setRows(data.funding);
      setExceptions(data.exceptions);
    } else {
      setRows(await request('get', page === 'Markets' ? '/markets' : '/admin/disputes'));
      setExceptions([]);
    }
  }
  useEffect(() => {
    setRows([]);
    setSelected(null);
    setError('');
    void load().catch((e) => setError(e.message));
  }, [endpoint]);
  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openCase(id: string) {
    setBusy(true);
    setError('');
    try {
      setSelected(await request('get', '/disputes/{id}', { params: { id } }));
      setResolution('');
      setRefund('0');
      setRestock(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="alert success">{notice}</div>}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>
              {page === 'Markets'
                ? 'Market directory'
                : page === 'Disputes'
                  ? 'Support cases'
                  : 'Wallet funding verification'}
            </h2>
            <p>
              {page === 'Reconciliation'
                ? 'Provider rechecks and exceptions. Bank settlement reconciliation remains separate work.'
                : page === 'Disputes'
                  ? 'Review evidence and record a reason before approving wallet adjustments.'
                  : 'Markets organise discovery by city, area and collection community.'}
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(load, 'Refreshed.')}
          >
            Refresh
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {(page === 'Markets'
                  ? ['Market', 'City / area', 'Pin', '']
                  : page === 'Disputes'
                    ? ['Case', 'Produce', 'Reason', 'Status', '']
                    : ['Reference', 'Payer', 'Provider', 'Amount', 'Status', '']
                ).map((label, i) => (
                  <th key={i}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {page === 'Markets' ? (
                    <>
                      <td>
                        <b>{r.name}</b>
                      </td>
                      <td>
                        {r.city}
                        <small>{r.area}</small>
                      </td>
                      <td>{r.latitude == null ? 'Not set' : `${r.latitude}, ${r.longitude}`}</td>
                      <td>{r.status}</td>
                    </>
                  ) : page === 'Disputes' ? (
                    <>
                      <td>
                        #{r.id.slice(0, 8)}
                        <small>{new Date(r.created_at).toLocaleString()}</small>
                      </td>
                      <td>
                        <b>{r.title}</b>
                        <small>
                          {r.booking_status} · {money(r.total_kobo)}
                        </small>
                      </td>
                      <td>{statusLabel(r.reason_code)}</td>
                      <td>
                        {r.status}
                        <small>Return: {statusLabel(r.return_status)}</small>
                      </td>
                      <td>
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => void openCase(r.id)}
                        >
                          Review case
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <code>{r.id.slice(0, 15)}</code>
                      </td>
                      <td>{r.payer_name}</td>
                      <td>{r.provider}</td>
                      <td>{money(r.amount_kobo)}</td>
                      <td>{r.status}</td>
                      <td>
                        {r.status !== 'SUCCESSFUL' && (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await request('post', '/admin/funding/{id}/recheck', {
                                  params: { id: r.id },
                                  body: {},
                                });
                              }, 'Funding verified with provider.')
                            }
                          >
                            Verify with provider
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="empty">
            <h3>No records yet</h3>
          </div>
        )}
      </section>
      {page === 'Markets' && (
        <section className="card settings-card">
          <h2>Add a market</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void run(async () => {
                await request('post', '/admin/markets', {
                  body: {
                    name: f.get('name'),
                    city: f.get('city'),
                    area: f.get('area'),
                    ...(f.get('latitude') || f.get('longitude')
                      ? {
                          latitude: Number(f.get('latitude')),
                          longitude: Number(f.get('longitude')),
                        }
                      : {}),
                  },
                });
                form.reset();
              }, 'Market added.');
            }}
          >
            <label>
              Market name
              <input name="name" required minLength={2} maxLength={120} />
            </label>
            <div className="settings-grid">
              <label>
                City
                <input name="city" required minLength={2} maxLength={100} />
              </label>
              <label>
                Area
                <input name="area" required minLength={2} maxLength={100} />
              </label>
            </div>
            <div className="settings-grid">
              <label>
                Latitude (optional)
                <input name="latitude" type="number" step="any" min="-90" max="90" />
              </label>
              <label>
                Longitude (optional)
                <input name="longitude" type="number" step="any" min="-180" max="180" />
              </label>
            </div>
            <button className="primary" disabled={busy}>
              Create market
            </button>
          </form>
        </section>
      )}
      {page === 'Reconciliation' && (
        <section className="card settings-card">
          <h2>Verification exceptions</h2>
          {exceptions.length ? (
            exceptions.map((e) => (
              <div key={e.id} style={{ padding: '14px 0', borderBottom: '1px solid #e5eadb' }}>
                <b>{e.funding_id}</b>
                <p>
                  {e.reason} · {e.status}
                </p>
                {e.resolution && <p>{e.resolution}</p>}
              </div>
            ))
          ) : (
            <p>No funding verification exceptions recorded.</p>
          )}
        </section>
      )}
      {selected && (
        <section className="card settings-card">
          <div className="card-head" style={{ padding: 0 }}>
            <h2>Case #{selected.id.slice(0, 8)}</h2>
            <button className="secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <dl>
            <dt>Booking</dt>
            <dd>{selected.title}</dd>
            <dt>Reason</dt>
            <dd>{statusLabel(selected.reason_code)}</dd>
            <dt>Description</dt>
            <dd>{selected.description}</dd>
            <dt>Status</dt>
            <dd>{selected.status}</dd>
            <dt>Return</dt>
            <dd>{statusLabel(selected.return_status)}</dd>
          </dl>
          <h2>Private evidence</h2>
          {selected.evidence.map((file: any) => (
            <p key={file.id}>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const d = await request('get', '/evidence/{id}/link', {
                      params: { id: file.id },
                    });
                    window.open(d.url, '_blank', 'noopener,noreferrer');
                  }, 'Attachment link opened.')
                }
              >
                {file.filename} ↗
              </button>
            </p>
          ))}
          {!selected.evidence.length && <p>No attachments submitted yet.</p>}
          {selected.status === 'OPEN' ? (
            <>
              <div className="modal-actions">
                {selected.return_status === 'NONE' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request('post', '/disputes/{id}/return', {
                          params: { id: selected.id },
                          body: { action: 'request' },
                        });
                        setSelected(
                          await request('get', '/disputes/{id}', { params: { id: selected.id } }),
                        );
                      }, 'Return requested.')
                    }
                  >
                    Require goods return
                  </button>
                )}
                {selected.return_status === 'REQUIRED' && (
                  <p>The seller must confirm receipt before this case can be resolved.</p>
                )}
              </div>
              <form
                style={{ marginTop: 25 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await request('post', '/admin/disputes/{id}/resolve', {
                      params: { id: selected.id },
                      body: {
                        resolution,
                        refund_kobo: Math.round(Number(refund) * 100),
                        restock,
                      },
                    });
                    setSelected(null);
                  }, 'Case resolved. Any approved wallet adjustment has been recorded.');
                }}
              >
                <label>
                  Decision and reason
                  <textarea
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    minLength={10}
                    maxLength={4000}
                    required
                  />
                </label>
                <label>
                  Wallet refund (₦)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={refund}
                    onChange={(e) => setRefund(e.target.value)}
                    required
                  />
                  <small>
                    Before collection, refund the full paid amount or zero. Completed pickups can
                    receive a reviewed partial refund. This credits the app wallet; it does not
                    reverse a bank/card funding transaction.
                  </small>
                </label>
                <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                  <input
                    style={{ width: 'auto' }}
                    type="checkbox"
                    checked={restock}
                    onChange={(e) => setRestock(e.target.checked)}
                  />
                  Restore returned goods to available stock (full refund and confirmed return
                  required)
                </label>
                <button
                  className="primary"
                  disabled={busy || selected.return_status === 'REQUIRED'}
                >
                  Resolve case
                </button>
              </form>
            </>
          ) : (
            <>
              <p>{selected.resolution}</p>
              <p>Approved refund: {money(selected.refund_kobo)}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
