import React, { useState, useEffect } from 'react';
import { api } from './api';
export default function OperationsPanel({ page }: { page: 'Users' | 'Reports' | 'Email queue' }) {
  const [rows, setRows] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState<any>(null),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const endpoint =
    page === 'Users'
      ? '/admin/users'
      : page === 'Reports'
        ? '/admin/reports'
        : '/admin/email-queue';
  async function load() {
    setRows(await api(endpoint));
  }
  useEffect(() => {
    setRows([]);
    setError('');
    setSelected(null);
    void load().catch((e) => setError(e.message));
    const id = setInterval(() => void load().catch(() => {}), 30000);
    return () => clearInterval(id);
  }, [endpoint]);
  async function action(path: string, body: object) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, 'POST', body);
      setSelected(null);
      setReason('');
      setNotice('Operation recorded.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {notice && <div className="alert success">{notice}</div>}
      <div className="toolbar">
        <input
          aria-label="Search records"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search records"
        />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {(page === 'Users'
                ? ['Account', 'Contact', 'Verification', 'Status', '']
                : page === 'Reports'
                  ? ['Report', 'Reporter', 'Reason', 'Status', '']
                  : ['Notification', 'Recipient', 'Attempts', 'Status', '']
              ).map((label, i) => (
                <th key={i}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => JSON.stringify(r).toLowerCase().includes(query.toLowerCase()))
              .map((r) => (
                <tr key={r.id}>
                  {page === 'Users' ? (
                    <>
                      <td>
                        <b>{r.name}</b>
                        <small>{r.admin ? 'Administrator' : 'Member'}</small>
                      </td>
                      <td>
                        {r.email}
                        <small>{r.phone}</small>
                      </td>
                      <td>{r.email_verified_at ? 'Email verified' : 'Not yet verified'}</td>
                      <td>{r.status}</td>
                      <td>
                        {!r.admin && (
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setSelected(r);
                              setReason('');
                            }}
                          >
                            Manage
                          </button>
                        )}
                      </td>
                    </>
                  ) : page === 'Reports' ? (
                    <>
                      <td>
                        <b>{r.subject_type}</b>
                        <small>{r.subject_id.slice(0, 12)}</small>
                      </td>
                      <td>{r.reporter_name}</td>
                      <td className="metadata">
                        {r.reason}
                        {r.resolution && <small>{r.resolution}</small>}
                      </td>
                      <td>{r.status}</td>
                      <td>
                        {r.status === 'OPEN' && (
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setSelected(r);
                              setReason('');
                            }}
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <b>{r.title}</b>
                        <small>{new Date(r.created_at).toLocaleString()}</small>
                      </td>
                      <td>{r.recipient_name}</td>
                      <td>
                        {r.attempts}
                        <small>{r.last_error}</small>
                      </td>
                      <td>{r.status}</td>
                      <td>
                        {r.status === 'FAILED' && (
                          <button
                            disabled={busy}
                            className="secondary compact"
                            onClick={() => void action(`/admin/email-queue/${r.id}/retry`, {})}
                          >
                            Retry
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
      {rows.length === 0 && (
        <div className="empty">
          <h3>No records yet</h3>
          <p>New activity will appear here.</p>
        </div>
      )}
      {selected && (
        <div className="settings-card" style={{ borderTop: '1px solid #e4e9df' }}>
          <h2>{page === 'Users' ? `Manage ${selected.name}` : 'Resolve report'}</h2>
          <label>
            {page === 'Users' ? 'Reason for account status change' : 'Resolution notes'}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={2000}
            />
          </label>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setSelected(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || reason.trim().length < 5}
              onClick={() =>
                void action(
                  page === 'Users'
                    ? `/admin/users/${selected.id}/status`
                    : `/admin/reports/${selected.id}/resolve`,
                  page === 'Users'
                    ? { status: selected.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason }
                    : { resolution: reason },
                )
              }
            >
              {page === 'Users'
                ? selected.status === 'ACTIVE'
                  ? 'Suspend account'
                  : 'Restore account'
                : 'Resolve report'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
