-- ===== Verified businesses (separate from approval and from anything paid) =====
ALTER TABLE sellers ADD COLUMN verification_status text NOT NULL DEFAULT 'NONE'
  CHECK (verification_status IN ('NONE','PENDING','INFO_REQUESTED','VERIFIED','REJECTED','SUSPENDED','EXPIRED'));
ALTER TABLE sellers ADD COLUMN verification_details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE sellers ADD COLUMN verified_at timestamptz;
ALTER TABLE sellers ADD COLUMN verification_expires_at timestamptz;
ALTER TABLE sellers ADD COLUMN verification_reviewed_by text REFERENCES users(id);
CREATE INDEX sellers_verification_idx ON sellers(verification_status);
-- Every application and decision, for the audit history.
CREATE TABLE verification_events (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(user_id) ON DELETE CASCADE,
  status text NOT NULL,
  note text NOT NULL DEFAULT '',
  actor_id text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_events_seller_idx ON verification_events(seller_id, created_at DESC);

-- ===== Commission rules =====
-- A category can have its own rate (e.g. a lower introductory rate); NULL uses the default.
ALTER TABLE catalogue_categories ADD COLUMN commission_bps integer CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 3000);
-- Owner switches for each paid feature and commission.
ALTER TABLE settings ADD COLUMN monetisation jsonb NOT NULL DEFAULT
  '{"transaction_commission":true,"delivery_commission":true,"sponsored_products":true,"featured_sellers":true,"local_ads":true}';

-- ===== Promotion packages (fixed duration, admin-priced) =====
CREATE TABLE promotion_packages (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('PRODUCT','SELLER')),
  name text NOT NULL,
  days integer NOT NULL CHECK (days BETWEEN 1 AND 365),
  price_kobo bigint NOT NULL CHECK (price_kobo >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO promotion_packages(id,kind,name,days,price_kobo) VALUES
  ('pkg-product-7','PRODUCT','7-day boost',7,350000),
  ('pkg-product-14','PRODUCT','14-day boost',14,600000),
  ('pkg-product-30','PRODUCT','30-day boost',30,1100000),
  ('pkg-seller-7','SELLER','Featured shop, 7 days',7,500000),
  ('pkg-seller-14','SELLER','Featured shop, 14 days',14,900000),
  ('pkg-seller-30','SELLER','Featured shop, 30 days',30,1600000);
ALTER TABLE promotions ADD COLUMN package_id text REFERENCES promotion_packages(id);

-- ===== Featured sellers (paid shop promotion; never a trust badge) =====
CREATE TABLE featured_sellers (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(user_id),
  package_id text REFERENCES promotion_packages(id),
  days integer NOT NULL,
  fee_kobo bigint NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  cancel_reason text,
  refund_kobo bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX featured_sellers_active_idx ON featured_sellers(status, ends_at);

-- ===== Local business advertising (advertisers need not sell on Ahia) =====
CREATE TABLE ad_campaigns (
  id text PRIMARY KEY,
  advertiser text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  image_url text,
  link_url text,
  cta text NOT NULL DEFAULT 'Learn more',
  states text[] NOT NULL DEFAULT '{}',
  lgas text[] NOT NULL DEFAULT '{}',
  categories text[] NOT NULL DEFAULT '{}',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  price_kobo bigint NOT NULL CHECK (price_kobo >= 0),
  paid_kobo bigint NOT NULL DEFAULT 0 CHECK (paid_kobo >= 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ENDED')),
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ad_campaigns_live_idx ON ad_campaigns(status, starts_at, ends_at);
CREATE TABLE ad_payments (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES ad_campaigns(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  reference text NOT NULL,
  recorded_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Delivery partner companies =====
CREATE TABLE delivery_partners (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  states text[] NOT NULL DEFAULT '{}',
  -- Ahia's share of each completed delivery made by this partner's riders.
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 5000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE drivers ADD COLUMN partner_id text REFERENCES delivery_partners(id) ON DELETE SET NULL;
ALTER TABLE deliveries ADD COLUMN partner_id text REFERENCES delivery_partners(id);

-- ===== Complaint case management on support cases =====
ALTER TABLE disputes ADD COLUMN assigned_to text REFERENCES users(id);
ALTER TABLE disputes ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT'));
-- What was bought and from whom, frozen when the case was opened.
ALTER TABLE disputes ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE disputes ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE case_notes (
  id text PRIMARY KEY,
  dispute_id text NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id text REFERENCES users(id),
  -- MESSAGE: buyer or seller reply; INTERNAL: staff only; UPDATE: staff message to both parties.
  kind text NOT NULL CHECK (kind IN ('MESSAGE','INTERNAL','UPDATE','SYSTEM')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_notes_dispute_idx ON case_notes(dispute_id, created_at);
