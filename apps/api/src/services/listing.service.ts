import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { listingSchema } from '../validators/marketplace.validators.js';

/** Saves the pre-order window (harvest date and capacity) when the request includes it. */
export async function savePreorder(
  q: Query,
  listingId: string,
  d: z.infer<typeof listingSchema> | Partial<z.infer<typeof listingSchema>>,
) {
  if (d.available_from === undefined && d.preorder_capacity === undefined) return;
  if (d.available_from)
    ensure(
      new Date(d.available_from).getTime() > Date.now(),
      400,
      'INVALID_HARVEST_DATE',
      'The pre-order date must be in the future.',
    );
  await q.query(
    'UPDATE listings SET available_from=CASE WHEN $1 THEN $2::timestamptz ELSE available_from END,preorder_capacity=COALESCE($3,preorder_capacity) WHERE id=$4',
    [
      d.available_from !== undefined,
      d.available_from ?? null,
      d.preorder_capacity ?? null,
      listingId,
    ],
  );
}

/** Listing photos must be the seller's own uploads (or external HTTPS images). */
export async function validateImages(q: Query, uid: string, images: string[]) {
  for (const url of images) {
    if (url.startsWith('https://') && !url.includes('/media/')) continue;
    const [own] = await q.query('SELECT id FROM media WHERE owner_id=$1 AND url=$2', [uid, url]);
    ensure(
      own,
      400,
      'INVALID_MEDIA',
      'Choose photos uploaded by your seller account or an HTTPS image URL.',
    );
  }
}
