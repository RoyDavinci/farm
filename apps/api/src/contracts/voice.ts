import { z } from 'zod';
import { voiceSignalInput } from '../services/voice.service.js';
const ok = z.object({ ok: z.boolean() });
export const voiceResponses: Record<string, z.ZodType> = {
  'voice.settings': z.object({
    enabled: z.boolean(),
    ice_servers: z.array(
      z.object({
        urls: z.array(z.string()),
        username: z.string().optional(),
        credential: z.string().optional(),
      }),
    ),
    ice_transport_policy: z.enum(['relay', 'all']),
    relay_configured: z.boolean(),
    notice: z.string(),
  }),
  'voice.active': z
    .object({
      id: z.string(),
      caller_id: z.string(),
      callee_id: z.string(),
      status: z.string(),
      expires_at: z.string(),
    })
    .nullable(),
  'voice.start': z.object({ id: z.string() }),
  'voice.action': ok,
  'voice.signal': ok,
  'voice.signals': z.object({
    status: z.string(),
    signals: z.array(voiceSignalInput.and(z.object({ id: z.string() }))),
  }),
};
