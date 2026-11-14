import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Database } from '../database/client.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const tokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

interface PushJob {
  job_id: string;
  attempts: number;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  booking_id: string | null;
  push_enabled: boolean | null;
}

/**
 * Sends queued notifications to Expo's push service. Jobs are claimed with a lease so several
 * workers can run safely. Tokens Expo reports as unregistered are disabled.
 */
export async function deliverPush(db: Database, c: Config, send: typeof fetch = fetch) {
  if (!c.pushEnabled) return;
  for (let round = 0; round < 5; round++) {
    const jobs = await db.transaction(async (q) => {
      const rows =
        await q.query<PushJob>(`SELECT o.id AS job_id,o.attempts,n.user_id,n.kind,n.title,n.body,n.booking_id,p.push_enabled
        FROM push_outbox o JOIN notifications n ON n.id=o.notification_id
        LEFT JOIN notification_preferences p ON p.user_id=n.user_id
        WHERE o.status='PENDING' AND o.available_at<=now() AND (o.locked_until IS NULL OR o.locked_until<now())
        ORDER BY o.created_at LIMIT 50 FOR UPDATE OF o SKIP LOCKED`);
      for (const j of rows)
        await q.query(
          "UPDATE push_outbox SET locked_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
          [j.job_id],
        );
      return rows;
    });
    if (!jobs.length) return;
    const messages: { job: PushJob; token: string }[] = [];
    const skipped: string[] = [];
    for (const job of jobs) {
      if (job.push_enabled === false) {
        skipped.push(job.job_id);
        continue;
      }
      const tokens = await db.query<{ token: string }>(
        'SELECT token FROM push_tokens WHERE user_id=$1 AND disabled_at IS NULL',
        [job.user_id],
      );
      if (!tokens.length) skipped.push(job.job_id);
      for (const t of tokens) messages.push({ job, token: t.token });
    }
    for (const id of skipped)
      await db.query("UPDATE push_outbox SET status='SKIPPED',locked_until=NULL WHERE id=$1", [id]);
    const failed = new Set<string>();
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await send(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(c.expoPushToken ? { Authorization: `Bearer ${c.expoPushToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map(({ job, token }) => ({
              to: token,
              title: job.title,
              body: job.body,
              sound: 'default',
              channelId: 'default',
              data: { kind: job.kind, booking_id: job.booking_id },
            })),
          ),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
        const tickets: any[] = ((await res.json()) as any).data || [];
        for (const [k, ticket] of tickets.entries()) {
          if (ticket?.status !== 'error') continue;
          if (ticket.details?.error === 'DeviceNotRegistered')
            await db.query('UPDATE push_tokens SET disabled_at=now() WHERE token=$1', [
              batch[k].token,
            ]);
          else failed.add(batch[k].job.job_id);
        }
      } catch {
        for (const m of batch) failed.add(m.job.job_id);
      }
    }
    for (const job of jobs) {
      if (skipped.includes(job.job_id)) continue;
      if (failed.has(job.job_id))
        await db.query(
          "UPDATE push_outbox SET status=$1,locked_until=NULL,last_error='PUSH_DELIVERY_FAILED',available_at=$2 WHERE id=$3",
          [
            job.attempts >= 4 ? 'FAILED' : 'PENDING',
            new Date(Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)),
            job.job_id,
          ],
        );
      else
        await db.query(
          "UPDATE push_outbox SET status='SENT',locked_until=NULL,last_error=NULL WHERE id=$1",
          [job.job_id],
        );
    }
  }
}

/** Business logic for push requests. HTTP-free: callers pass plain input. */
export function createPushService(deps: AppDeps) {
  const { db } = deps;
  async function registerPushToken(user: any, input: RequestInput) {
    const d = z
      .object({
        token: z.string().regex(tokenPattern, 'Invalid Expo push token.'),
        platform: z.enum(['ios', 'android', 'web']),
      })
      .parse(input.body);
    // A device token belongs to whoever signed in on that device most recently.
    const user_id = user.id;
    await db.prisma.pushToken.upsert({
      where: { token: d.token },
      create: { token: d.token, user_id, platform: d.platform },
      update: { user_id, platform: d.platform, last_seen_at: new Date(), disabled_at: null },
    });
    return { ok: true };
  }
  async function removePushToken(user: any, input: RequestInput) {
    const d = z.object({ token: z.string().max(200) }).parse(input.body ?? {});
    await db.prisma.pushToken.deleteMany({
      where: { token: d.token, user_id: user.id },
    });
    return { ok: true };
  }
  return { registerPushToken, removePushToken };
}
