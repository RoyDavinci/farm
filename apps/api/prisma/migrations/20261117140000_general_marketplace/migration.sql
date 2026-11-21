ALTER TABLE listings ADD COLUMN condition TEXT NOT NULL DEFAULT 'NEW' CHECK (condition IN ('NEW','USED','REFURBISHED'));
ALTER TABLE deliveries ADD COLUMN requested_driver_id TEXT REFERENCES users(id);
CREATE INDEX deliveries_requested_driver_idx ON deliveries(requested_driver_id,status);
ALTER TABLE payouts ADD COLUMN source_account TEXT NOT NULL DEFAULT 'seller_payable', ADD COLUMN source_owner TEXT, ADD COLUMN shopping_request_id TEXT;

CREATE TABLE shopping_requests (
  id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id), rider_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','ACCEPTED','SHOPPING','PURCHASED','DELIVERED','CANCELLED')),
  items TEXT NOT NULL, source_name TEXT NOT NULL, source_address TEXT NOT NULL,
  source_latitude DOUBLE PRECISION NOT NULL CHECK(source_latitude BETWEEN -90 AND 90),
  source_longitude DOUBLE PRECISION NOT NULL CHECK(source_longitude BETWEEN -180 AND 180),
  dropoff_address TEXT NOT NULL,
  dropoff_latitude DOUBLE PRECISION NOT NULL CHECK(dropoff_latitude BETWEEN -90 AND 90),
  dropoff_longitude DOUBLE PRECISION NOT NULL CHECK(dropoff_longitude BETWEEN -180 AND 180),
  goods_budget_kobo INTEGER NOT NULL CHECK(goods_budget_kobo>0),
  delivery_fee_kobo INTEGER NOT NULL CHECK(delivery_fee_kobo>=0),
  commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
  payment_mode TEXT NOT NULL CHECK(payment_mode IN ('REIMBURSE','ADVANCE')),
  quote_version INTEGER NOT NULL DEFAULT 1,
  actual_goods_kobo INTEGER CHECK(actual_goods_kobo>0 AND actual_goods_kobo<=goods_budget_kobo),
  reimbursement_kobo INTEGER CHECK(reimbursement_kobo>=0), receipt_note TEXT,
  delivery_pin TEXT NOT NULL, pin_failures INTEGER NOT NULL DEFAULT 0, pin_locked_until TIMESTAMPTZ,
  review_open BOOLEAN NOT NULL DEFAULT FALSE, review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at TIMESTAMPTZ, purchased_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
  CHECK(buyer_id<>rider_id)
);
CREATE INDEX shopping_requests_buyer_id_created_at_idx ON shopping_requests(buyer_id,created_at);
CREATE INDEX shopping_requests_rider_id_status_idx ON shopping_requests(rider_id,status);
CREATE TABLE shopping_messages (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES shopping_requests(id),
  sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shopping_messages_request_id_created_at_idx ON shopping_messages(request_id,created_at);
ALTER TABLE payouts ADD CONSTRAINT payouts_shopping_request_id_fkey FOREIGN KEY(shopping_request_id) REFERENCES shopping_requests(id);
ALTER TABLE payouts ADD CONSTRAINT payouts_source_check CHECK(source_account IN ('seller_payable','shopping_advance'));
