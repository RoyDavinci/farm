-- Anyone can withdraw money they added to their wallet; it goes through the same payout review.
ALTER TABLE payouts DROP CONSTRAINT payouts_source_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_source_check
  CHECK (source_account IN ('seller_payable','shopping_advance','wallet'));
