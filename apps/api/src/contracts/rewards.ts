import { z } from 'zod';

const ok = z.object({ ok: z.literal(true) });
const person = z.object({ ahia_id: z.string(), name: z.string() });

/** Ahia IDs, wallet transfers, referral links and promo codes. */
export const rewardsResponses = {
  'rewards.findRecipient': person.extend({ business_name: z.string().nullable() }),
  'rewards.sendTransfer': z.object({ id: z.string(), amount_kobo: z.number().int(), to: person }),
  'rewards.listTransfers': z.array(
    z.object({
      id: z.string(),
      amount_kobo: z.number().int(),
      note: z.string().nullable(),
      created_at: z.string(),
      direction: z.enum(['SENT', 'RECEIVED']),
      other: person,
    }),
  ),
  'rewards.myReferrals': z.object({
    code: z.string(),
    link: z.string(),
    reward_kobo: z.number().int(),
    welcome_kobo: z.number().int(),
    min_order_kobo: z.number().int(),
    hold_days: z.number().int(),
    earned_kobo: z.number().int(),
    invited: z.number().int(),
    rewarded: z.number().int(),
    people: z.array(z.object({ name: z.string(), joined_at: z.string(), rewarded: z.boolean() })),
  }),
  'rewards.referrer': z.object({ code: z.string(), name: z.string() }),
  'rewards.redeemPromo': z.object({
    code: z.string(),
    kind: z.enum(['CREDIT', 'CASHBACK']),
    message: z.string(),
  }),
  'rewards.myPromos': z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      kind: z.string(),
      percent: z.number().int(),
      max_kobo: z.number().int(),
      min_order_kobo: z.number().int(),
      ends_at: z.string().nullable(),
      status: z.enum(['PENDING', 'PAID', 'EXPIRED']),
      amount_kobo: z.number().int(),
      created_at: z.string(),
    }),
  ),
  'rewards.adminPromos': z.array(
    z.looseObject({
      id: z.string(),
      code: z.string(),
      kind: z.string(),
      amount_kobo: z.number().int(),
      percent: z.number().int(),
      max_kobo: z.number().int(),
      min_order_kobo: z.number().int(),
      max_uses: z.number().int().nullable(),
      new_customers_only: z.boolean(),
      ends_at: z.string().nullable(),
      active: z.boolean(),
      note: z.string().nullable(),
      uses: z.number().int(),
      paid_kobo: z.number().int(),
      created_at: z.string(),
    }),
  ),
  'rewards.createPromo': z.object({ id: z.string(), code: z.string() }),
  'rewards.setPromoActive': ok,
  'rewards.adminReferrals': z.object({
    settings: z.object({
      referral_reward_kobo: z.number().int(),
      referral_welcome_kobo: z.number().int(),
      referral_min_order_kobo: z.number().int(),
      credit_hold_days: z.number().int(),
    }),
    totals: z.object({
      invited: z.number().int(),
      rewarded: z.number().int(),
      referral_paid_kobo: z.number().int(),
      promo_paid_kobo: z.number().int(),
    }),
    top: z.array(
      z.object({
        ahia_id: z.string(),
        name: z.string(),
        invited: z.number().int(),
        rewarded: z.number().int(),
      }),
    ),
  }),
  'rewards.saveReferralSettings': ok,
};
