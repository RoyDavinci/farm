import { randomUUID } from 'node:crypto';
import type { Query } from '../database/client.js';

const id = () => randomUUID();

/** Append-only record of sensitive actions: who did what, to which entity, and why. */
export async function audit(
  q: Query,
  actor: string | null,
  action: string,
  entity: string,
  meta: object = {},
) {
  await q.query('INSERT INTO audit(id,actor_id,action,entity_id,metadata) VALUES($1,$2,$3,$4,$5)', [
    id(),
    actor,
    action,
    entity,
    JSON.stringify(meta),
  ]);
}
