import type { Query } from '../database/client.js';
import type { AuthenticatedUser } from './auth.service.js';
import type { ResolveDisputeInput } from '../validators/support.validators.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { release } from './booking.service.js';
import { notify } from './communications.service.js';
import { lockedBalance, ledger } from './ledger.service.js';
export async function getDisputeForUser(q: Query, disputeId: string, u: AuthenticatedUser) {
  const [d] = await q.query(
    'SELECT d.*,b.buyer_id,b.seller_id,b.title FROM disputes d JOIN bookings b ON b.id=d.booking_id WHERE d.id=$1',
    [disputeId],
  );
  ensure(
    d && (u.admin || d.buyer_id === u.id || d.seller_id === u.id),
    404,
    'NOT_FOUND',
    'Support case not found.',
  );
  return d;
}

export async function resolveSupportCase(
  q: Query,
  u: AuthenticatedUser,
  disputeId: string,
  data: ResolveDisputeInput,
) {
  const lookup = await getDisputeForUser(q, disputeId, u);
  const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [lookup.booking_id]);
  const [d] = await q.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [lookup.id]);
  ensure(d.status === 'OPEN', 409, 'CASE_CLOSED', 'This case is already resolved.');
  ensure(
    data.refund_kobo <= b.total_kobo && (!data.refund_kobo || b.paid),
    400,
    'INVALID_REFUND',
    'Refund exceeds the paid order amount.',
  );
  ensure(
    d.return_status !== 'REQUIRED',
    409,
    'RETURN_REQUIRED',
    'The seller must confirm receipt of the return first.',
  );
  ensure(
    !data.restock ||
      (b.status === 'COMPLETED' &&
        d.return_status === 'RECEIVED' &&
        data.refund_kobo === b.total_kobo),
    400,
    'RESTOCK_NOT_ALLOWED',
    'Only fully refunded, confirmed returned goods can be restocked.',
  );
  if (data.refund_kobo) {
    if (b.status === 'COMPLETED') {
      const fee = Math.round((data.refund_kobo * b.commission_kobo) / b.total_kobo),
        sellerDebit = data.refund_kobo - fee;
      ensure(
        (await lockedBalance(q, b.seller_id, 'seller_payable')) >= sellerDebit,
        409,
        'SELLER_FUNDS_REQUIRED',
        'Seller payable balance is insufficient. Escalate this case before refunding.',
      );
      await ledger(q, d.id, [
        { account: 'seller_payable', owner: b.seller_id, amount: -sellerDebit },
        { account: 'platform_revenue', amount: -fee },
        { account: 'wallet', owner: b.buyer_id, amount: data.refund_kobo },
      ]);
      if (data.restock && d.return_status === 'RECEIVED' && data.refund_kobo === b.total_kobo) {
        await q.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE', [b.listing_id]);
        await q.query('UPDATE listing_variants SET stock=stock+$1 WHERE id=$2', [
          b.quantity,
          b.variant_id,
        ]);
        await q.query(
          'UPDATE listings SET stock=v.stock FROM listing_variants v WHERE v.listing_id=listings.id AND v.is_primary AND listings.id=$1',
          [b.listing_id],
        );
      }
    } else {
      ensure(
        data.refund_kobo === b.total_kobo,
        400,
        'FULL_REFUND_REQUIRED',
        'An uncollected order can only be fully refunded or left unchanged.',
      );
      await release(q, b, 'CANCELLED', u.id, 'Support approved a full refund.');
    }
  }
  if (!data.refund_kobo && ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status))
    await q.query('UPDATE bookings SET reserved_until=$1 WHERE id=$2', [
      new Date(Date.now() + Number(d.reservation_remaining_ms || 168 * 3600000)),
      b.id,
    ]);
  await q.query(
    "UPDATE disputes SET status='RESOLVED',resolution=$1,refund_kobo=$2,resolved_at=now() WHERE id=$3",
    [data.resolution, data.refund_kobo, d.id],
  );
  await audit(q, u.id, 'dispute.resolve', d.id, data);
  for (const uid of [b.buyer_id, b.seller_id])
    await notify(q, uid, 'dispute', 'Support case resolved', data.resolution, b.id);
  return { ok: true };
}
