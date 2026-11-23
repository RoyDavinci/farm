-- Document kinds: the driver kinds the app already offers, plus a selfie for seller verification.
ALTER TABLE seller_documents DROP CONSTRAINT seller_documents_kind_check;
ALTER TABLE seller_documents ADD CONSTRAINT seller_documents_kind_check CHECK (kind IN (
  'government_id','business_registration','proof_of_address','drivers_licence','vehicle_registration',
  'profile_photo','vehicle_photo','operating_permit','insurance','selfie','other'));

-- Devices that completed an emailed code. Signing in again from one skips the code; only a hash of
-- the device token is stored. A password reset removes them all.
CREATE TABLE trusted_devices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'Unknown device',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX trusted_devices_user_idx ON trusted_devices(user_id);
