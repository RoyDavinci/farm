-- Existing PROCESSING payouts are ambiguous: verify them, never redispatch them.
ALTER TABLE payouts
  ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN recovery_token TEXT,
  ADD COLUMN recovery_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN recovery_error TEXT;
CREATE INDEX payouts_recovery_idx ON payouts(status, recovery_after);
