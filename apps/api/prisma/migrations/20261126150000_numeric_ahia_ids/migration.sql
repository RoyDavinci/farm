-- Ahia IDs become "AH-" and 8 digits (AH-48213957): easy to read out and type on a phone keypad.
-- The letters version was only days old on test servers, so every ID is reissued.
CREATE OR REPLACE FUNCTION new_ahia_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  out text;
BEGIN
  LOOP
    -- The first digit is never 0, so IDs always show all 8 digits.
    out := 'AH-' || (1 + floor(random() * 9))::int || lpad(floor(random() * 10000000)::int::text, 7, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE ahia_id = out);
  END LOOP;
  RETURN out;
END $$;
UPDATE users SET ahia_id = new_ahia_id();

-- Fingerprint (or face) confirmation: a device registers a secret after the owner enters their
-- transaction PIN; the secret stays in the device's secure storage behind the fingerprint.
CREATE TABLE biometric_keys (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  secret_hash text NOT NULL,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX biometric_keys_user_idx ON biometric_keys(user_id) WHERE revoked_at IS NULL;
