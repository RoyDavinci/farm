import { useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
import { Badge, Empty } from '../ui';
export default function LocalStatusPage() {
  const { action, busy, setError } = useAdmin();
  const fetchRows = () => request('get', '/admin/local-status');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchRows>>>([]),
    [reason, setReason] = useState<Record<string, string>>({});
  const load = useCallback(
    () =>
      fetchRows()
        .then(setRows)
        .catch((e) => setError(e.message)),
    [setError],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Local Status moderation</h2>
          <p>
            Review temporary product posts and reports. Removing a status does not remove its
            product listing.
          </p>
        </div>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {!rows.length && (
        <Empty
          title="No local statuses yet"
          text="Seller updates and reported content appear here."
        />
      )}
      {rows.map((row) => (
        <div key={row.id} className="settings-card">
          <div className="card-head">
            <h3>
              {row.title} · {row.business_name}
            </h3>
            <Badge
              status={
                new Date(row.expires_at).getTime() <= Date.now() && row.status === 'ACTIVE'
                  ? 'EXPIRED'
                  : row.status
              }
            />
          </div>
          {row.media_type === 'VIDEO' ? (
            <video
              src={row.media_url}
              controls
              preload="metadata"
              style={{ maxWidth: 400, maxHeight: 300 }}
            />
          ) : (
            <img
              src={row.media_url}
              alt="Local Status media"
              loading="lazy"
              style={{ maxWidth: 300, maxHeight: 240, objectFit: 'contain' }}
            />
          )}
          <p>{row.caption}</p>
          <small>
            Published {new Date(row.created_at).toLocaleString()} · Expires{' '}
            {new Date(row.expires_at).toLocaleString()}
          </small>
          <p>{row.report_count} reports</p>
          {row.reports.map((report, i) => (
            <p key={i}>
              {report.reason} · {new Date(report.created_at).toLocaleString()}
            </p>
          ))}
          {row.status !== 'REMOVED' && (
            <>
              <label>
                Removal reason
                <textarea
                  value={reason[row.id] || ''}
                  onChange={(e) => setReason({ ...reason, [row.id]: e.target.value })}
                  maxLength={1000}
                />
              </label>
              <button
                disabled={busy || (reason[row.id] || '').trim().length < 5}
                onClick={() =>
                  void action(async () => {
                    await request('post', '/admin/local-status/{id}/remove', {
                      params: { id: row.id },
                      body: { reason: reason[row.id] },
                    });
                    await load();
                  }, 'Status removed from discovery.')
                }
              >
                Remove status
              </button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
