CREATE INDEX status_event_campaign_idx ON local_status_events(campaign_key);
CREATE INDEX status_click_campaign_idx ON status_clicks(campaign_id);
CREATE INDEX status_click_cleanup_idx ON status_clicks(expires_at) WHERE booking_id IS NULL;
