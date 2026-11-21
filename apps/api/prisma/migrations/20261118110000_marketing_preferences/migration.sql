ALTER TABLE notification_preferences ADD COLUMN marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN last_marketing_at TIMESTAMPTZ;
