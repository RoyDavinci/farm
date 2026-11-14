import type { RequestHandler } from 'express';
import { z } from 'zod';
import { tokenPattern } from '../services/push.service.js';
import type { AppDeps } from '../types/deps.js';

/** Device push tokens for Expo notifications. */
export function createPushController(deps: AppDeps) {
  const { db } = deps;

  const registerPushToken: RequestHandler = async (req, res) => {
    const d = z
      .object({
        token: z.string().regex(tokenPattern, 'Invalid Expo push token.'),
        platform: z.enum(['ios', 'android', 'web']),
      })
      .parse(req.body);
    // A device token belongs to whoever signed in on that device most recently.
    const user_id = res.locals.user.id;
    await db.prisma.pushToken.upsert({
      where: { token: d.token },
      create: { token: d.token, user_id, platform: d.platform },
      update: { user_id, platform: d.platform, last_seen_at: new Date(), disabled_at: null },
    });
    res.json({ ok: true });
  };
  const removePushToken: RequestHandler = async (req, res) => {
    const d = z.object({ token: z.string().max(200) }).parse(req.body ?? {});
    await db.prisma.pushToken.deleteMany({
      where: { token: d.token, user_id: res.locals.user.id },
    });
    res.json({ ok: true });
  };
  return { registerPushToken, removePushToken };
}
