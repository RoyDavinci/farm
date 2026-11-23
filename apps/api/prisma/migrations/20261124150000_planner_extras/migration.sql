-- Planner extras: pictures, live market prices, a buy-by timeline with reminders, family
-- assignments, price-drop alerts and restock reminders.
ALTER TABLE plan_items ADD COLUMN icon text;
ALTER TABLE plan_items ADD COLUMN photo_url text;
-- ESTIMATE (our price list) or MARKET (prices of active listings on Ahia).
ALTER TABLE plan_items ADD COLUMN price_source text NOT NULL DEFAULT 'ESTIMATE';
ALTER TABLE plan_items ADD COLUMN market_sellers integer NOT NULL DEFAULT 0;
ALTER TABLE plan_items ADD COLUMN buy_by date;
ALTER TABLE plan_items ADD COLUMN reminded_at timestamptz;
ALTER TABLE plan_items ADD COLUMN assignee_id text REFERENCES users(id);
ALTER TABLE plan_items ADD COLUMN linked_price_kobo bigint;
ALTER TABLE plans ADD COLUMN repeat_reminded_at timestamptz;
CREATE INDEX plan_items_buy_by_idx ON plan_items(buy_by) WHERE buy_by IS NOT NULL AND reminded_at IS NULL;
CREATE INDEX plan_items_linked_idx ON plan_items(variant_id) WHERE linked_price_kobo IS NOT NULL;
