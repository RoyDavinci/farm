-- Card checkout can pay a subscription or membership.
ALTER TABLE funding DROP CONSTRAINT funding_purpose_check;
ALTER TABLE funding ADD CONSTRAINT funding_purpose_check CHECK (purpose IN ('wallet','booking','delivery','subscription'));

-- Everything a team member changes on a shop account, for the owner to review.
CREATE TABLE team_activity (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(user_id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_activity_seller_idx ON team_activity(seller_id, created_at DESC);
