-- Smart Planner (no AI): plans built from templates and recipes, linked to real listings.
CREATE TABLE plans (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('HOME','EVENT','FOOD','PERSONAL','OFFICE','CUSTOM')),
  template text,
  budget_kobo bigint CHECK (budget_kobo IS NULL OR budget_kobo >= 0),
  people integer CHECK (people IS NULL OR people BETWEEN 1 AND 2000),
  rooms integer CHECK (rooms IS NULL OR rooms BETWEEN 1 AND 20),
  tier text NOT NULL DEFAULT 'STANDARD' CHECK (tier IN ('BASIC','STANDARD','PREMIUM')),
  target_date date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_user_idx ON plans(user_id, updated_at DESC);

CREATE TABLE plan_items (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'Items',
  name text NOT NULL,
  category text,
  keywords text NOT NULL DEFAULT '',
  quantity double precision NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'piece',
  -- Estimate for the whole line, never a live price.
  budget_kobo bigint NOT NULL DEFAULT 0 CHECK (budget_kobo >= 0),
  priority text NOT NULL DEFAULT 'IMPORTANT' CHECK (priority IN ('ESSENTIAL','IMPORTANT','OPTIONAL')),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','SAVED','PURCHASED','UNAVAILABLE','NOT_NEEDED','OWNED')),
  listing_id text REFERENCES listings(id) ON DELETE SET NULL,
  variant_id text REFERENCES listing_variants(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('TEMPLATE','RECIPE','MANUAL')),
  ingredient_key text,
  allergens text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_items_plan_idx ON plan_items(plan_id, position);

CREATE TABLE plan_meals (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  recipe text NOT NULL,
  day integer NOT NULL DEFAULT 1 CHECK (day BETWEEN 1 AND 31),
  meal text NOT NULL DEFAULT 'DINNER' CHECK (meal IN ('BREAKFAST','LUNCH','DINNER')),
  servings integer NOT NULL CHECK (servings BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_meals_plan_idx ON plan_meals(plan_id, day);

-- Sensitive: allergies and diet. Only the owner reads it; never shown to sellers.
CREATE TABLE diet_profiles (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  allergies text[] NOT NULL DEFAULT '{}',
  intolerances text[] NOT NULL DEFAULT '{}',
  avoid text[] NOT NULL DEFAULT '{}',
  patterns text[] NOT NULL DEFAULT '{}',
  consented_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Multi-seller cart: checkout turns each line into an ordinary booking request.
CREATE TABLE cart_items (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  variant_id text NOT NULL REFERENCES listing_variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  plan_item_id text REFERENCES plan_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, variant_id)
);
CREATE INDEX cart_items_user_idx ON cart_items(user_id, created_at);

-- A booking made from a plan counts towards that plan's spending.
ALTER TABLE bookings ADD COLUMN plan_item_id text REFERENCES plan_items(id) ON DELETE SET NULL;
CREATE INDEX bookings_plan_item_idx ON bookings(plan_item_id) WHERE plan_item_id IS NOT NULL;
