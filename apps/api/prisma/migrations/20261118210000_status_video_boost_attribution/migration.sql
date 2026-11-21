ALTER TABLE media ADD COLUMN media_type TEXT NOT NULL DEFAULT 'IMAGE' CHECK (media_type IN ('IMAGE','VIDEO')), ADD COLUMN duration_seconds DOUBLE PRECISION;
ALTER TABLE local_statuses ADD COLUMN media_type TEXT NOT NULL DEFAULT 'IMAGE' CHECK (media_type IN ('IMAGE','VIDEO')), ADD COLUMN duration_seconds DOUBLE PRECISION;
ALTER TABLE settings ADD COLUMN status_boost_hourly_kobo INTEGER NOT NULL DEFAULT 2500 CHECK(status_boost_hourly_kobo BETWEEN 0 AND 10000000);
CREATE TABLE status_boosts (
 id TEXT PRIMARY KEY, status_id TEXT NOT NULL REFERENCES local_statuses(id),seller_id TEXT NOT NULL REFERENCES sellers(user_id),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','COMPLETED','CANCELLED','REJECTED')),
 hours INTEGER NOT NULL CHECK(hours BETWEEN 1 AND 72),fee_kobo INTEGER NOT NULL CHECK(fee_kobo>=0),refund_kobo INTEGER NOT NULL DEFAULT 0 CHECK(refund_kobo>=0 AND refund_kobo<=fee_kobo),
 targets JSONB NOT NULL CHECK(jsonb_typeof(targets)='array' AND jsonb_array_length(targets) BETWEEN 1 AND 5),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,reason TEXT,reviewed_by TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX status_boost_running_idx ON status_boosts(status_id) WHERE status IN ('PENDING','ACTIVE');
CREATE INDEX status_boost_seller_idx ON status_boosts(seller_id,created_at DESC);
ALTER TABLE local_status_events ADD COLUMN campaign_key TEXT NOT NULL DEFAULT 'organic';
UPDATE local_status_events SET campaign_key='listing' WHERE sponsored;
ALTER TABLE local_status_events DROP CONSTRAINT local_status_events_pkey;
ALTER TABLE local_status_events ADD PRIMARY KEY(status_id,viewer_key,sponsored,campaign_key);
CREATE TABLE status_clicks (
 id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES users(id),status_id TEXT NOT NULL REFERENCES local_statuses(id),listing_id TEXT NOT NULL REFERENCES listings(id),
 campaign_id TEXT REFERENCES status_boosts(id),sponsored BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL,
 booking_id TEXT UNIQUE REFERENCES bookings(id)
);
CREATE INDEX status_click_attribution_idx ON status_clicks(status_id,campaign_id,booking_id);
CREATE INDEX status_click_buyer_idx ON status_clicks(buyer_id,created_at DESC);
