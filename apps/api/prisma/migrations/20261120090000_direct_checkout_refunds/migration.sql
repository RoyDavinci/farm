-- Direct checkout: a provider payment can be for one purchase instead of an open wallet top-up.
ALTER TABLE funding ADD COLUMN purpose text NOT NULL DEFAULT 'wallet';
ALTER TABLE funding ADD COLUMN target_id text;
ALTER TABLE funding ADD CONSTRAINT funding_purpose_check CHECK (purpose IN ('wallet','booking','delivery'));
-- Money already refunded to the card against this payment.
ALTER TABLE funding ADD COLUMN refunded_kobo integer NOT NULL DEFAULT 0;
ALTER TABLE funding ADD CONSTRAINT funding_refund_limit CHECK (refunded_kobo >= 0 AND refunded_kobo <= amount_kobo);
ALTER TABLE funding ADD COLUMN credited_at timestamptz;
CREATE INDEX funding_refundable_idx ON funding(user_id, credited_at DESC) WHERE status = 'SUCCESSFUL';

-- Refunds back to the original payment method (used when the wallet feature is off).
-- PENDING → SENDING (request in flight) → REFUNDED, or FAILED / SENDING-with-error for staff.
-- A SENDING refund is never sent again automatically: its outcome may be unknown.
CREATE TABLE card_refunds (
  id text PRIMARY KEY,
  funding_id text NOT NULL REFERENCES funding(id),
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  amount_kobo integer NOT NULL CHECK (amount_kobo > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','REFUNDED','FAILED')),
  provider_refund_id text,
  error text,
  resolved_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_refunds_status_idx ON card_refunds(status, created_at);
CREATE INDEX card_refunds_user_idx ON card_refunds(user_id, created_at DESC);
