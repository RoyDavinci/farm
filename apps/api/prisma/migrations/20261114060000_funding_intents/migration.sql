-- A durable intent surrounds hosted checkout I/O; no provider call holds a DB transaction.
CREATE TABLE funding_intents (
  actor_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  requested_provider TEXT NOT NULL,
  current_reference TEXT NOT NULL UNIQUE REFERENCES funding(id),
  status TEXT NOT NULL DEFAULT 'INITIALIZING'
    CHECK (status IN ('INITIALIZING','READY','FAILED','UNCERTAIN')),
  lease_until TIMESTAMPTZ NOT NULL,
  response JSONB,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,key)
);
CREATE INDEX funding_intents_recovery_idx ON funding_intents(status,lease_until);
