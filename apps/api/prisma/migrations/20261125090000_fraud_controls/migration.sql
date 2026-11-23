-- Fraud controls: money holds and cool-downs, frozen accounts, verified identity, device links,
-- risk flags for staff, delivery evidence, pay-on-delivery limits and two-person payout approval.

ALTER TABLE users ADD COLUMN money_locked_until timestamptz;
ALTER TABLE users ADD COLUMN money_lock_reason text;
ALTER TABLE users ADD COLUMN frozen_at timestamptz;
ALTER TABLE users ADD COLUMN frozen_reason text;
ALTER TABLE users ADD COLUMN bvn_verified_at timestamptz;
ALTER TABLE users ADD COLUMN verified_name text;
ALTER TABLE users ADD COLUMN pod_refusals integer NOT NULL DEFAULT 0;

-- Devices each account uses (an install id the app sends), to spot linked accounts.
CREATE TABLE user_devices (
  user_id text NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  ip text,
  user_agent text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX user_devices_device_idx ON user_devices(device_id);

-- Things staff should look at. One open flag per user, kind and related account.
CREATE TABLE risk_flags (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  related_user_id text REFERENCES users(id),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLEARED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_by text REFERENCES users(id),
  cleared_at timestamptz,
  note text
);
CREATE UNIQUE INDEX risk_flags_open_idx ON risk_flags(user_id, kind, COALESCE(related_user_id, '')) WHERE status = 'OPEN';
CREATE INDEX risk_flags_status_idx ON risk_flags(status, created_at DESC);

-- Identity checks with a provider (BVN through Flutterwave).
CREATE TABLE kyc_checks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  kind text NOT NULL DEFAULT 'BVN',
  reference text UNIQUE,
  consent_url text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','MISMATCH','FAILED')),
  bvn_last4 text NOT NULL,
  first_name text,
  last_name text,
  middle_name text,
  date_of_birth text,
  nin_match boolean,
  watchlisted boolean,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyc_checks_user_idx ON kyc_checks(user_id, created_at DESC);

-- The BVN record's photo is kept with the person's private documents for staff to compare.
ALTER TABLE seller_documents DROP CONSTRAINT seller_documents_kind_check;
ALTER TABLE seller_documents ADD CONSTRAINT seller_documents_kind_check CHECK (kind IN (
  'government_id','business_registration','proof_of_address','drivers_licence','vehicle_registration',
  'profile_photo','vehicle_photo','operating_permit','insurance','selfie','other','bvn_photo'));

-- Bank accounts: a hash to spot the same account on several users; staff can allow a name mismatch.
ALTER TABLE payout_accounts ADD COLUMN account_hash text;
ALTER TABLE payout_accounts ADD COLUMN staff_allowed_by text REFERENCES users(id);
ALTER TABLE payout_accounts ADD COLUMN staff_allowed_at timestamptz;
CREATE INDEX payout_accounts_hash_idx ON payout_accounts(account_hash) WHERE account_hash IS NOT NULL;

-- Large payouts need two different staff members.
ALTER TABLE payouts ADD COLUMN first_approved_by text REFERENCES users(id);
ALTER TABLE payouts ADD COLUMN first_approved_at timestamptz;
ALTER TABLE settings ADD COLUMN payout_dual_approval_kobo integer NOT NULL DEFAULT 50000000;

-- Delivery evidence: a photo and position when the rider checks the goods and when they deliver.
ALTER TABLE deliveries ADD COLUMN check_photo_url text;
ALTER TABLE deliveries ADD COLUMN check_latitude double precision;
ALTER TABLE deliveries ADD COLUMN check_longitude double precision;
ALTER TABLE deliveries ADD COLUMN delivered_photo_url text;
ALTER TABLE deliveries ADD COLUMN delivered_latitude double precision;
ALTER TABLE deliveries ADD COLUMN delivered_longitude double precision;
ALTER TABLE deliveries ADD COLUMN refused_at timestamptz;

-- Messages that look like a request to pay outside Ahia carry a warning.
ALTER TABLE messages ADD COLUMN warning text;
