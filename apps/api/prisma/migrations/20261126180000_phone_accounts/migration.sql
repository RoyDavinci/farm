-- Accounts can be opened with a phone number alone (many customers have no email).
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;
-- One-time codes go by email or text message; "email" holds the phone number for SMS codes.
ALTER TABLE otp_challenges ADD COLUMN channel text NOT NULL DEFAULT 'email';
-- Fingerprint keys: PAY confirms money moves, LOGIN signs in on that phone.
ALTER TABLE biometric_keys ADD COLUMN purpose text NOT NULL DEFAULT 'PAY';
