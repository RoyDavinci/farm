import { createHash } from 'node:crypto';
import { isTransientConflict, type Database } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { Mutate } from '../types/deps.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Read the common request identity without keeping a transaction open around I/O. */
export function readIdempotency(req: {
  header(name: string): string | undefined;
  method: string;
  originalUrl: string;
  body?: unknown;
}) {
  const key = req.header('Idempotency-Key');
  ensure(
    key && key.length >= 8 && key.length <= 150,
    400,
    'IDEMPOTENCY_REQUIRED',
    'Send an Idempotency-Key of 8–150 characters.',
  );
  return {
    key,
    fingerprint: hash(JSON.stringify([req.method, req.originalUrl, req.body ?? null])),
  };
}

/**
 * Builds the `mutate` helper used by controllers for every money, order or account change:
 * - requires an Idempotency-Key header (8–150 chars);
 * - locks the acting user's row so their mutations run one at a time;
 * - replays the stored response when the same key is retried with the same request;
 * - rejects a reused key with a different request.
 * A handler may return `{ error: { status, code, message } }` to commit partial state (such as a
 * failed PIN attempt counter) and still answer with an error.
 * A transaction that Postgres aborts as a deadlock or serialization conflict has fully rolled back
 * (including the idempotency record), so it is retried up to twice before failing.
 */
export function createMutate(db: Database): Mutate {
  return (req, res, fn) => {
    const { key, fingerprint } = readIdempotency(req);
    const actor = res.locals.user;
    const attempt = () =>
      db.transaction(async (q) => {
        await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
        const old = await q.prisma.idempotencyKey.findUnique({
          where: { actor_id_key: { actor_id: actor.id, key } },
        });
        if (old) {
          ensure(
            old.request_hash === fingerprint,
            409,
            'IDEMPOTENCY_CONFLICT',
            'This key was already used for a different request.',
          );
          return old.response as any;
        }
        const data = await fn(q, actor);
        await q.prisma.idempotencyKey.create({
          data: {
            actor_id: actor.id,
            key,
            request_hash: fingerprint,
            response: JSON.parse(JSON.stringify(data ?? null)),
          },
        });
        return data;
      });
    const run = async (tries = 0): Promise<any> => {
      try {
        return await attempt();
      } catch (err) {
        if (tries >= 2 || !isTransientConflict(err)) throw err;
        await new Promise((r) => setTimeout(r, 25 * (tries + 1) + Math.random() * 25));
        return run(tries + 1);
      }
    };
    return run().then((data) => {
      if (data?.error) res.status(data.error.status).json({ error: data.error });
      else res.json(data);
    });
  };
}
