-- ===== Story likes (views already counted in local_status_events) =====
CREATE TABLE local_status_likes (
  status_id text NOT NULL REFERENCES local_statuses(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, user_id)
);

-- ===== Sharing a plan with family =====
CREATE TABLE plan_members (
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('VIEWER','EDITOR')),
  invited_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);
CREATE INDEX plan_members_user_idx ON plan_members(user_id);

-- ===== Planner content edited by staff (overrides the defaults in code) =====
CREATE TABLE planner_content (
  type text NOT NULL CHECK (type IN ('TEMPLATE','RECIPE','INGREDIENT')),
  key text NOT NULL,
  data jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_by text REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type, key)
);

-- ===== Seller subscriptions and buyer membership =====
CREATE TABLE subscription_plans (
  id text PRIMARY KEY,
  audience text NOT NULL CHECK (audience IN ('SELLER','BUYER')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_kobo bigint NOT NULL CHECK (price_kobo >= 0),
  period_days integer NOT NULL CHECK (period_days BETWEEN 1 AND 366),
  features jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO subscription_plans(id,audience,name,description,price_kobo,period_days,features) VALUES
 ('seller-pro','SELLER','Seller Pro','Market insights, the listing assistant and a business report.',500000,30,
  '{"insights":true,"ai_assistant":true,"business_report":true,"bulk_import":false,"team_seats":1,"api_access":false}'),
 ('seller-business','SELLER','Business','Everything in Pro, plus bulk upload, team accounts and API access for your systems.',1500000,30,
  '{"insights":true,"ai_assistant":true,"business_report":true,"bulk_import":true,"team_seats":5,"api_access":true}'),
 ('ahia-plus','BUYER','Ahia Plus','Member-only deals and delivery offers from participating sellers.',200000,30,
  '{"member_deals":true,"delivery_offer":true}');
CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES subscription_plans(id),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('PENDING_PAYMENT','ACTIVE','CANCELLED','EXPIRED')),
  fee_kobo bigint NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'proceeds',
  payment_reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE INDEX subscriptions_user_idx ON subscriptions(user_id, status, ends_at);

-- ===== B2B: requests for quotes =====
CREATE TABLE rfqs (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name text NOT NULL DEFAULT '',
  title text NOT NULL,
  category text NOT NULL,
  quantity double precision NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  details text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  needed_by date,
  budget_kobo bigint CHECK (budget_kobo IS NULL OR budget_kobo >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','AWARDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rfqs_open_idx ON rfqs(status, category, created_at DESC);
CREATE TABLE rfq_quotes (
  id text PRIMARY KEY,
  rfq_id text NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  seller_id text NOT NULL REFERENCES sellers(user_id),
  total_kobo bigint NOT NULL CHECK (total_kobo > 0),
  delivery_days integer NOT NULL CHECK (delivery_days BETWEEN 0 AND 365),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','ACCEPTED','DECLINED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, seller_id)
);

-- ===== Enterprise: team members on a seller account =====
CREATE TABLE seller_team_members (
  seller_id text NOT NULL REFERENCES sellers(user_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('MANAGER','STAFF')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, user_id)
);

-- ===== Partner integrations: API keys and outgoing webhooks =====
CREATE TABLE partner_api_keys (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(user_id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE partner_webhooks (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(user_id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE partner_webhook_deliveries (
  id text PRIMARY KEY,
  webhook_id text NOT NULL REFERENCES partner_webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX partner_webhook_deliveries_due_idx ON partner_webhook_deliveries(status, next_attempt_at);
