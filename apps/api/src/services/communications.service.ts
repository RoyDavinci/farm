import { randomUUID } from 'node:crypto';
import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';
import { mailer } from '../lib/mail.js';
export async function notify(
  q: Query,
  user: string,
  kind: string,
  title: string,
  body: string,
  booking?: string,
) {
  const nid = randomUUID();
  await q.query(
    'INSERT INTO notifications(id,user_id,kind,title,body,booking_id) VALUES($1,$2,$3,$4,$5,$6)',
    [nid, user, kind, title, body, booking || null],
  );
  await q.query('INSERT INTO notification_outbox(id,notification_id) VALUES($1,$2)', [
    randomUUID(),
    nid,
  ]);
  await q.query('INSERT INTO push_outbox(id,notification_id) VALUES($1,$2)', [randomUUID(), nid]);
}

interface DeliveryJob {
  job_id: string;
  attempts: number;
  email_enabled: boolean | null;
  email_verified_at: Date | null;
  email: string;
  title: string;
  body: string;
}
export async function deliverNotifications(db: Database, c: Config) {
  const mail = mailer(c);
  for (let i = 0; i < 10; i++) {
    const job = await db.transaction(async (q) => {
      const [job] =
        await q.query<DeliveryJob>(`SELECT o.id AS job_id,o.attempts,n.title,n.body,u.email,u.email_verified_at,p.email_enabled
    FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.user_id
    LEFT JOIN notification_preferences p ON p.user_id=n.user_id
    WHERE o.status='PENDING' AND o.available_at<=now() AND (o.locked_until IS NULL OR o.locked_until<now())
    ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
      if (!job) return null;
      await q.query(
        "UPDATE notification_outbox SET locked_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
        [job.job_id],
      );
      return job;
    });
    if (!job) break;
    try {
      if (job.email_enabled !== false && job.email_verified_at)
        await mail.send(
          job.email,
          `Farmers Market: ${job.title}`,
          `${job.body}\n\nOpen the Farmers Market app for details.\nManage email alerts in Account → Notifications.`,
        );
      await db.query(
        "UPDATE notification_outbox SET status='SENT',locked_until=NULL,last_error=NULL WHERE id=$1",
        [job.job_id],
      );
    } catch {
      await db.query(
        "UPDATE notification_outbox SET status=$1,locked_until=NULL,last_error='EMAIL_DELIVERY_FAILED',available_at=$2 WHERE id=$3",
        [
          job.attempts >= 4 ? 'FAILED' : 'PENDING',
          new Date(Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts)),
          job.job_id,
        ],
      );
    }
  }
}
