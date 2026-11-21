import { useCallback, useEffect, useState } from 'react';
import { money } from '@ahia/shared';
import { request } from '../api';
import { useAdmin } from '../AdminContext';
import { Badge, Empty } from '../ui';
export default function StatusBoostsPage() {
  const { busy, action, setError } = useAdmin();
  const fetchRows = () => request('get', '/admin/status-boosts');
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
          <h2>Boost Status campaigns</h2>
          <p>
            Review audience, duration and held budget. Approval starts the campaign; rejection
            returns the full hold. Stopping an active campaign returns unused time.
          </p>
        </div>
        <button onClick={() => void load()}>Refresh</button>
      </div>
      {!rows.length && (
        <Empty title="No campaigns yet" text="Seller campaigns appear here for review." />
      )}
      {rows.map((c) => (
        <div key={c.id} className="settings-card">
          <div className="card-head">
            <h3>
              {c.title} · {c.business_name}
            </h3>
            <Badge status={c.status} />
          </div>
          {c.media_type === 'VIDEO' ? (
            <video
              src={c.media_url}
              controls
              preload="metadata"
              style={{ maxWidth: 400, maxHeight: 260 }}
            />
          ) : (
            <img
              src={c.thumbnail_url}
              alt="Campaign status preview"
              style={{ maxWidth: 300, maxHeight: 240 }}
            />
          )}
          <p>{c.caption}</p>
          <p>Status expires {new Date(c.status_expires_at).toLocaleString()}</p>
          <p>
            Budget {money(c.fee_kobo)} · {c.hours} hours · Returned {money(c.refund_kobo)}
          </p>
          <p>{c.targets.map((t) => `${t.kind}: ${t.name}, ${t.state}`).join(' · ')}</p>
          <p>
            {c.starts_at ? `Started ${new Date(c.starts_at).toLocaleString()}` : 'Not started'}
            {c.ends_at ? ` · Ends ${new Date(c.ends_at).toLocaleString()}` : ''}
          </p>
          <p>
            {c.views} views · {c.product_clicks} product clicks · {c.bookings} bookings ·{' '}
            {c.completed_bookings} completed
          </p>
          <p>{c.reason}</p>
          {['PENDING', 'ACTIVE'].includes(c.status) && (
            <>
              <label>
                Review reason
                <textarea
                  value={reason[c.id] || ''}
                  maxLength={1000}
                  onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })}
                />
              </label>
              {(c.status === 'PENDING' ? ['approve', 'reject'] : ['stop']).map((kind) => (
                <button
                  key={kind}
                  disabled={busy || (reason[c.id] || '').trim().length < 5}
                  onClick={() =>
                    void action(async () => {
                      await request('post', '/admin/status-boosts/{id}/review', {
                        params: { id: c.id },
                        body: { action: kind, reason: reason[c.id] },
                      });
                      await load();
                    }, 'Campaign review saved.')
                  }
                >
                  {kind === 'approve'
                    ? 'Approve & start'
                    : kind === 'reject'
                      ? 'Reject & return budget'
                      : 'Stop & return unused budget'}
                </button>
              ))}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
