-- Buyers report missing or wrong allergen information (a listing or a recipe); staff review it.
CREATE TABLE allergen_reports (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id text REFERENCES listings(id) ON DELETE SET NULL,
  recipe text,
  -- MISSING: no allergen information; INCORRECT: information is wrong; REACTION: someone reacted.
  issue text NOT NULL CHECK (issue IN ('MISSING','INCORRECT','REACTION','OTHER')),
  allergens text[] NOT NULL DEFAULT '{}',
  details text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
  resolution text,
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (listing_id IS NOT NULL OR recipe IS NOT NULL)
);
CREATE INDEX allergen_reports_status_idx ON allergen_reports(status, created_at);
CREATE INDEX allergen_reports_reporter_idx ON allergen_reports(reporter_id, created_at DESC);
