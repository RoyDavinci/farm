-- Sales: a temporary lower price with the usual price kept to show "was ₦X" and to restore after.
ALTER TABLE listings ADD COLUMN was_price_kobo integer;
ALTER TABLE listings ADD COLUMN sale_until timestamptz;
CREATE INDEX listings_sale_idx ON listings(sale_until) WHERE sale_until IS NOT NULL;

-- Price watches: a buyer follows a listing, a catalogue product or a search, and hears when the
-- lowest price falls below what it was when they started watching (a price cut or a sale).
CREATE TABLE price_watches (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  listing_id text REFERENCES listings(id),
  catalogue_product_id text REFERENCES catalogue_products(id),
  query text,
  label text NOT NULL,
  baseline_kobo integer,
  active boolean NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(listing_id, catalogue_product_id, query) = 1)
);
CREATE UNIQUE INDEX price_watches_target_idx ON price_watches(user_id, COALESCE(listing_id,''), COALESCE(catalogue_product_id,''), COALESCE(lower(query),'')) WHERE active;
CREATE INDEX price_watches_active_idx ON price_watches(active) WHERE active;

-- "Request what you need": a buyer asks for something; the best-matched sellers are alerted and
-- can offer one of their listings.
CREATE TABLE product_requests (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES users(id),
  text text NOT NULL,
  category text,
  latitude double precision,
  longitude double precision,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX product_requests_buyer_idx ON product_requests(buyer_id, created_at DESC);
CREATE TABLE product_request_sellers (
  request_id text NOT NULL REFERENCES product_requests(id),
  seller_id text NOT NULL REFERENCES users(id),
  rank integer NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, seller_id)
);
CREATE INDEX product_request_sellers_seller_idx ON product_request_sellers(seller_id, notified_at DESC);
CREATE TABLE product_request_offers (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES product_requests(id),
  seller_id text NOT NULL REFERENCES users(id),
  listing_id text NOT NULL REFERENCES listings(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, seller_id)
);
