-- Transaction PIN: required to withdraw money or change the payout bank account.
ALTER TABLE users ADD COLUMN transaction_pin_hash text;
ALTER TABLE users ADD COLUMN transaction_pin_failures integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN transaction_pin_locked_until timestamptz;

-- Rider-fronted escrow: the rider checks the goods at the seller and pays the item price
-- into escrow; once the seller confirms handover, escrow is released to the seller.
ALTER TABLE deliveries ADD COLUMN rider_checked_at timestamptz;
ALTER TABLE deliveries ADD COLUMN rider_check_note text;
ALTER TABLE deliveries ADD COLUMN rider_fronted_kobo bigint NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN seller_released_at timestamptz;

-- Buyers order now and pay later: on delivery, or when collecting.
UPDATE settings SET pay_on_delivery_enabled = TRUE WHERE id = 1;
ALTER TABLE settings ALTER COLUMN pay_on_delivery_enabled SET DEFAULT TRUE;

-- Delivery is ₦500 per kilometre (minimum one kilometre), for every vehicle and region.
UPDATE vehicle_types SET base_fare_kobo = 0, per_km_kobo = 50000, min_fare_kobo = 50000;
UPDATE delivery_tariffs SET base_kobo = 0, per_km_kobo = 50000, per_kg_kobo = 0,
  waiting_per_minute_kobo = 0, demand_bps = 10000, surcharge_kobo = 0;
