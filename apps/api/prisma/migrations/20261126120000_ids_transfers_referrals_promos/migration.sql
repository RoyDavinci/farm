-- Ahia ID: a short public ID for every account ("AH" + 6 characters without look-alikes such as
-- 0/O and 1/I/L). People send money to it and share it as their referral code.
CREATE OR REPLACE FUNCTION new_ahia_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text;
BEGIN
  LOOP
    out := 'AH';
    FOR i IN 1..6 LOOP
      out := out || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE ahia_id = out);
  END LOOP;
  RETURN out;
END $$;
ALTER TABLE users ADD COLUMN ahia_id text;
UPDATE users SET ahia_id = new_ahia_id() WHERE ahia_id IS NULL;
ALTER TABLE users ALTER COLUMN ahia_id SET DEFAULT new_ahia_id();
ALTER TABLE users ALTER COLUMN ahia_id SET NOT NULL;
CREATE UNIQUE INDEX users_ahia_id_key ON users(ahia_id);

-- Who invited whom; the reward is paid once, after the new customer's first completed order.
ALTER TABLE users ADD COLUMN referred_by text REFERENCES users(id);
ALTER TABLE users ADD COLUMN referral_rewarded_at timestamptz;
CREATE INDEX users_referred_by_idx ON users(referred_by) WHERE referred_by IS NOT NULL;

-- Wallet-to-wallet transfers between Ahia accounts.
CREATE TABLE wallet_transfers (
  id text PRIMARY KEY,
  from_user_id text NOT NULL REFERENCES users(id),
  to_user_id text NOT NULL REFERENCES users(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX wallet_transfers_from_idx ON wallet_transfers(from_user_id, created_at DESC);
CREATE INDEX wallet_transfers_to_idx ON wallet_transfers(to_user_id, created_at DESC);

-- Ahia credit from referrals and promo codes: spendable at once, withdrawable or sendable
-- only after the hold (so fake accounts can't cash rewards out).
CREATE TABLE wallet_credits (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  source text NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_credits_user_idx ON wallet_credits(user_id, created_at DESC);

-- Promo codes: CREDIT gives a fixed amount now; CASHBACK gives a percentage of the next
-- completed order back as credit (up to a cap).
CREATE TABLE promo_codes (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('CREDIT','CASHBACK')),
  amount_kobo bigint NOT NULL DEFAULT 0,
  percent int NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  max_kobo bigint NOT NULL DEFAULT 0,
  min_order_kobo bigint NOT NULL DEFAULT 0,
  max_uses int,
  new_customers_only boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE promo_redemptions (
  id text PRIMARY KEY,
  promo_id text NOT NULL REFERENCES promo_codes(id),
  user_id text NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('PENDING','PAID','EXPIRED')),
  booking_id text REFERENCES bookings(id),
  amount_kobo bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE (promo_id, user_id)
);
CREATE INDEX promo_redemptions_pending_idx ON promo_redemptions(user_id) WHERE status = 'PENDING';

ALTER TABLE settings ADD COLUMN referral_reward_kobo int NOT NULL DEFAULT 50000;
ALTER TABLE settings ADD COLUMN referral_welcome_kobo int NOT NULL DEFAULT 50000;
ALTER TABLE settings ADD COLUMN referral_min_order_kobo int NOT NULL DEFAULT 200000;
ALTER TABLE settings ADD COLUMN credit_hold_days int NOT NULL DEFAULT 30;
