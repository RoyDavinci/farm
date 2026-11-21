import { money, statusLabel, type Booking, type OrderEvent, type Seller } from '@zuru/shared';
import { useEffect, useState } from 'react';
import { useAdmin } from '../AdminContext';
import { request } from '../api';
import { Badge, Modal } from '../ui';
export function SellerReviewModal({
  seller: review,
  error,
  onClose,
}: {
  seller: Seller;
  error: string;
  onClose: () => void;
}) {
  const { busy, action } = useAdmin();
  const [reason, setReason] = useState('');
  return (
    <Modal title="Seller verification" close={onClose}>
      <span className="eyebrow">APPLICATION DETAILS</span>
      <h2>{review.business_name}</h2>
      <Badge status={review.status} />
      <dl>
        <dt>Business type</dt>
        <dd>{statusLabel(review.business_type)}</dd>
        <dt>City / area</dt>
        <dd>
          {review.city} / {review.area}
        </dd>
        <dt>Private collection address</dt>
        <dd>{review.address}</dd>
        {review.reason && (
          <>
            <dt>Previous decision</dt>
            <dd>{review.reason}</dd>
          </>
        )}
      </dl>
      <VerificationProfileDetails details={review.profile_details as Record<string, unknown>} />
      <SellerDocuments sellerId={review.user_id} />
      <label>
        Decision reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Record the checks completed or the issue to resolve"
          minLength={3}
        />
      </label>
      <div className="modal-actions">
        {(['REJECTED', 'SUSPENDED', 'APPROVED'] as const).map((status) => (
          <button
            disabled={busy || reason.trim().length < 3}
            key={status}
            className={status === 'APPROVED' ? 'primary' : 'secondary'}
            onClick={() =>
              void action(
                async () => {
                  await request('post', '/admin/sellers/{id}/review', {
                    params: { id: review.user_id },
                    body: {
                      status,
                      reason,
                    },
                  });
                  onClose();
                },
                `Seller ${statusLabel(status)}.`,
              )
            }
          >
            {status === 'APPROVED'
              ? 'Approve seller'
              : status === 'REJECTED'
                ? 'Reject'
                : 'Suspend'}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function TimelineModal({
  timeline,
  onClose,
}: {
  timeline: { booking: Booking; events: OrderEvent[] };
  onClose: () => void;
}) {
  return (
    <Modal title="Booking timeline" close={onClose}>
      <h2>{timeline.booking.title}</h2>
      <p>
        {timeline.booking.quantity} {timeline.booking.unit} · {money(timeline.booking.total_kobo)}
      </p>
      <Badge status={timeline.booking.status} />
      <dl>
        <dt>Buyer</dt>
        <dd>{timeline.booking.buyer_name}</dd>
        <dt>Seller</dt>
        <dd>{timeline.booking.business_name}</dd>
        <dt>Payment</dt>
        <dd>{timeline.booking.paid ? 'Paid from wallet' : 'Unpaid'}</dd>
        <dt>Commission</dt>
        <dd>
          {money(timeline.booking.commission_kobo)} ({timeline.booking.commission_bps / 100}%)
        </dd>
      </dl>
      <ol className="timeline">
        {timeline.events.map((e) => (
          <li key={e.id}>
            <b>{statusLabel(e.to_status)}</b>
            <p>{e.reason}</p>
            <small>{new Date(e.created_at).toLocaleString()}</small>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

/** Verification documents for a seller; links are short-lived and every view is audited. */
export function SellerDocuments({
  sellerId,
  subject = 'seller',
}: {
  sellerId: string;
  subject?: 'seller' | 'driver';
}) {
  const { busy, action, user } = useAdmin();
  const [docs, setDocs] = useState<any[]>([]);
  const [failed, setFailed] = useState('');
  const load = () =>
    (
      request('get', '/admin/seller-documents', {
        query: { seller_id: sellerId, subject },
      }) as Promise<any[]>
    )
      .then(setDocs)
      .catch((e) => setFailed(e.message));
  useEffect(() => void load(), [sellerId]);
  if (failed) return <p className="fine">Documents: {failed}</p>;
  return (
    <div className="documents">
      <span className="eyebrow">VERIFICATION DOCUMENTS</span>
      {!docs.length && <p className="fine">No documents uploaded yet.</p>}
      {docs.map((d) => (
        <div key={d.id} className="document-row">
          <span>
            <b>{statusLabel(d.kind)}</b>
            <small>
              {new Date(d.created_at).toLocaleDateString()}
              {d.review_note ? ` · ${d.review_note}` : ''}
            </small>
          </span>
          <Badge status={d.status} />
          <button
            className="secondary compact"
            onClick={() =>
              void (
                request('get', '/admin/seller-documents/{id}/link', {
                  params: { id: d.id },
                }) as Promise<{ url: string }>
              )
                .then(({ url }) => window.open(url, '_blank', 'noopener'))
                .catch((e) => setFailed(e.message))
            }
          >
            Open
          </button>
          {d.status === 'PENDING' &&
            (['ACCEPTED', 'REJECTED'] as const).map((status) => (
              <button
                key={status}
                className={status === 'ACCEPTED' ? 'primary compact' : 'secondary compact'}
                disabled={busy}
                onClick={() => {
                  const note = window.prompt(
                    status === 'ACCEPTED'
                      ? 'Note what you checked'
                      : 'What should the seller fix? (sent to them)',
                  );
                  if (note)
                    void action(async () => {
                      await request('post', '/admin/seller-documents/{id}/review', {
                        params: { id: d.id },
                        body: { status, note },
                      });
                      await load();
                    }, `Document ${status.toLowerCase()}.`);
                }}
              >
                {status === 'ACCEPTED' ? 'Accept' : 'Reject'}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

export function VerificationProfileDetails({ details }: { details?: Record<string, unknown> }) {
  if (!details || !Object.keys(details).length)
    return <p className="fine">No extended verification details submitted.</p>;
  return (
    <div className="settings-card">
      <h3>Submitted profile and location details</h3>
      <dl>
        {Object.entries(details)
          .filter(
            ([, value]) =>
              value !== null && value !== '' && (!Array.isArray(value) || value.length),
          )
          .map(([key, value]) => (
            <div key={key}>
              <dt>{key.replaceAll('_', ' ')}</dt>
              <dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
