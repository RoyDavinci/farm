-- "Buy it and bring it": someone says what they need ("I want to make egusi for 6"), Ahia builds
-- the shopping list, picks nearby sellers, and each seller's part is delivered at a chosen time.
CREATE TABLE errands (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES users(id),
  text text NOT NULL,
  servings integer,
  dropoff_latitude double precision NOT NULL,
  dropoff_longitude double precision NOT NULL,
  dropoff_address text NOT NULL,
  deliver_at timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX errands_buyer_idx ON errands(buyer_id, created_at DESC);

-- Multi-item orders: one order per seller holding several products (a basket), so a seller
-- packs once and one rider collects. Stock is reserved and returned per line.
CREATE TABLE booking_lines (
  id text PRIMARY KEY,
  booking_id text NOT NULL REFERENCES bookings(id),
  listing_id text NOT NULL REFERENCES listings(id),
  variant_id text NOT NULL REFERENCES listing_variants(id),
  title text NOT NULL,
  unit text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 1),
  price_kobo integer NOT NULL,
  needed text
);
CREATE INDEX booking_lines_booking_idx ON booking_lines(booking_id);
ALTER TABLE bookings ADD COLUMN errand_id text REFERENCES errands(id);
