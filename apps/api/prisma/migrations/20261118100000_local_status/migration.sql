ALTER TABLE sellers ADD COLUMN state TEXT NOT NULL DEFAULT '', ADD COLUMN lga TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN status_lifetime_hours INTEGER NOT NULL DEFAULT 24 CHECK (status_lifetime_hours BETWEEN 1 AND 72),
ADD COLUMN status_radius_km INTEGER NOT NULL DEFAULT 25 CHECK (status_radius_km BETWEEN 1 AND 100),
ADD COLUMN status_max_active INTEGER NOT NULL DEFAULT 10 CHECK (status_max_active BETWEEN 1 AND 30);
CREATE TABLE local_statuses (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(user_id), listing_id TEXT NOT NULL REFERENCES listings(id),
 caption TEXT NOT NULL DEFAULT '', media_url TEXT NOT NULL, thumbnail_url TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','DELETED','REMOVED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, moderation_reason TEXT
);
CREATE INDEX local_status_active_idx ON local_statuses(status,expires_at,created_at DESC,id);
CREATE INDEX local_status_seller_idx ON local_statuses(seller_id,created_at DESC);
CREATE TABLE local_status_events (
 status_id TEXT NOT NULL REFERENCES local_statuses(id), viewer_key TEXT NOT NULL,
 views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
 last_view_at TIMESTAMPTZ, last_click_at TIMESTAMPTZ, sponsored BOOLEAN NOT NULL,
 PRIMARY KEY(status_id,viewer_key,sponsored)
);
CREATE TABLE local_status_mutes (
 user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK (kind IN ('SELLER','CATEGORY')), target TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,kind,target)
);
CREATE TABLE local_status_reports (
 id TEXT PRIMARY KEY, status_id TEXT NOT NULL REFERENCES local_statuses(id), reporter_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(status_id,reporter_id)
);
