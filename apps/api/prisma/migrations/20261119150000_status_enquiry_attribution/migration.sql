ALTER TABLE status_clicks ADD COLUMN conversation_id text REFERENCES conversations(id);
CREATE INDEX status_clicks_conversation_idx ON status_clicks(conversation_id) WHERE conversation_id IS NOT NULL;
