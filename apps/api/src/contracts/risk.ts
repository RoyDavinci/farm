import { z } from 'zod';

const ok = z.object({ ok: z.literal(true) });
const check = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'VERIFIED', 'MISMATCH', 'FAILED']),
  consent_url: z.string().nullable(),
  bvn_last4: z.string(),
  name: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
});

/** Identity checks and the staff Risk queue. */
export const riskResponses: Record<string, z.ZodType> = {
  'risk.getKyc': z.object({
    available: z.boolean(),
    bvn_verified: z.boolean(),
    verified_name: z.string().nullable(),
    check: check.nullable(),
  }),
  'risk.startBvn': check,
  'risk.refreshBvn': check,
  'risk.listRisk': z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      detail: z.string(),
      status: z.enum(['OPEN', 'CLEARED']),
      created_at: z.string(),
      user: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        phone: z.string().nullable(),
        frozen: z.boolean(),
        bvn_verified: z.boolean(),
        joined_at: z.string(),
        open_flags: z.number().int(),
      }),
      related: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
      payout_account: z
        .object({
          id: z.string(),
          account_name: z.string(),
          bank_name: z.string(),
          last4: z.string(),
          allowed: z.boolean(),
        })
        .nullable(),
      cleared_by: z.string().nullable(),
      cleared_at: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  'risk.clearRisk': ok,
  'risk.freezeUser': ok,
  'risk.unfreezeUser': ok,
  'risk.allowPayoutAccount': ok,
};
