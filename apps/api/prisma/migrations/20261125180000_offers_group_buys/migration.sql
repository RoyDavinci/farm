-- Genuine deals. Every price a listing has had, so a sale's "was" price must be one the item
-- really sold at (for a week or more), not a price raised just before the sale.
CREATE TABLE listing_price_history (
  id bigserial PRIMARY KEY,
  listing_id text NOT NULL REFERENCES listings(id),
  price_kobo integer NOT NULL,
  from_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_price_history_idx ON listing_price_history(listing_id, from_at);
INSERT INTO listing_price_history(listing_id,price_kobo,from_at) SELECT id,price_kobo,created_at FROM listings;
CREATE FUNCTION record_listing_price() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.price_kobo IS DISTINCT FROM OLD.price_kobo THEN
    INSERT INTO listing_price_history(listing_id,price_kobo) VALUES (NEW.id, NEW.price_kobo);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER listings_price_history AFTER INSERT OR UPDATE OF price_kobo ON listings
  FOR EACH ROW EXECUTE FUNCTION record_listing_price();

-- A deal says how many units are available at the deal price; it ends when they're gone.
ALTER TABLE listings ADD COLUMN deal_stock_left integer;
-- TODAY (ends at midnight), WEEK (7 days) or DAYS (seller-chosen).
ALTER TABLE listings ADD COLUMN sale_kind text;

-- What buyers searched for (to suggest group buys to people who want the same thing).
CREATE TABLE search_queries (
  user_id text NOT NULL REFERENCES users(id),
  q text NOT NULL,
  day date NOT NULL DEFAULT current_date,
  PRIMARY KEY (user_id, q, day)
);

-- Group buying: people share one purchase (a goat, a bag of rice) and each pays their share.
-- Ahia funds a small discount (1–3%) from its commission.
CREATE TABLE group_buys (
  id text PRIMARY KEY,
  listing_id text NOT NULL REFERENCES listings(id),
  variant_id text NOT NULL REFERENCES listing_variants(id),
  creator_id text NOT NULL REFERENCES users(id),
  quantity integer NOT NULL CHECK (quantity >= 1),
  shares integer NOT NULL CHECK (shares BETWEEN 2 AND 10),
  full_price_kobo integer NOT NULL,
  discount_bps integer NOT NULL CHECK (discount_bps BETWEEN 0 AND 300),
  share_price_kobo integer NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ORDERED','DONE','CANCELLED','EXPIRED')),
  booking_id text REFERENCES bookings(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_buys_open_idx ON group_buys(status, expires_at) WHERE status = 'OPEN';
CREATE INDEX group_buys_listing_idx ON group_buys(listing_id);
CREATE TABLE group_buy_members (
  group_id text NOT NULL REFERENCES group_buys(id),
  user_id text NOT NULL REFERENCES users(id),
  shares integer NOT NULL DEFAULT 1 CHECK (shares >= 1),
  paid_kobo integer NOT NULL,
  invited_by text REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE group_buy_invites (
  group_id text NOT NULL REFERENCES group_buys(id),
  user_id text NOT NULL REFERENCES users(id),
  invited_by text REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE bookings ADD COLUMN group_buy_id text REFERENCES group_buys(id);
