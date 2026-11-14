-- Baseline: the schema built by the original SQL migrations 1-11 (pre-Prisma).
-- Existing databases: run 'npx prisma migrate resolve --applied 0_init' once.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.12
-- Dumped by pg_dump version 17.12




--
-- Name: audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit (
    id text NOT NULL,
    actor_id text,
    action text NOT NULL,
    entity_id text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id text NOT NULL,
    buyer_id text NOT NULL,
    seller_id text NOT NULL,
    listing_id text NOT NULL,
    title text NOT NULL,
    unit text NOT NULL,
    quantity integer NOT NULL,
    price_kobo integer NOT NULL,
    total_kobo integer NOT NULL,
    commission_bps integer NOT NULL,
    commission_kobo integer NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    pickup_code text NOT NULL,
    pickup_failures integer DEFAULT 0 NOT NULL,
    pickup_locked_until timestamp with time zone,
    reserved_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_id text,
    variant_name text DEFAULT 'Standard'::text NOT NULL,
    offer_quantity integer,
    offer_price_kobo integer,
    offer_note text,
    offer_expires_at timestamp with time zone,
    pickup_address_snapshot text,
    pickup_latitude double precision,
    pickup_longitude double precision,
    preorder boolean DEFAULT false NOT NULL,
    CONSTRAINT bookings_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'COUNTERED'::text, 'ACCEPTED'::text, 'READY_FOR_PICKUP'::text, 'COMPLETED'::text, 'DECLINED'::text, 'CANCELLED'::text, 'EXPIRED'::text])))
);


--
-- Name: consumed_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumed_refresh_tokens (
    token_hash text NOT NULL,
    session_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id text NOT NULL,
    buyer_id text NOT NULL,
    seller_id text NOT NULL,
    listing_id text NOT NULL,
    buyer_read_at timestamp with time zone DEFAULT now() NOT NULL,
    seller_read_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliveries (
    id text NOT NULL,
    booking_id text NOT NULL,
    buyer_id text NOT NULL,
    seller_id text NOT NULL,
    driver_id text,
    vehicle_type text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    pickup_latitude double precision NOT NULL,
    pickup_longitude double precision NOT NULL,
    dropoff_address text NOT NULL,
    dropoff_latitude double precision NOT NULL,
    dropoff_longitude double precision NOT NULL,
    distance_km double precision NOT NULL,
    fare_kobo bigint NOT NULL,
    commission_bps integer NOT NULL,
    pay_on_delivery boolean DEFAULT false NOT NULL,
    fare_paid boolean DEFAULT false NOT NULL,
    pickup_pin text NOT NULL,
    delivery_pin text NOT NULL,
    pin_failures integer DEFAULT 0 NOT NULL,
    pin_locked_until timestamp with time zone,
    driver_latitude double precision,
    driver_longitude double precision,
    driver_location_at timestamp with time zone,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    delivered_at timestamp with time zone,
    CONSTRAINT deliveries_fare_kobo_check CHECK ((fare_kobo > 0)),
    CONSTRAINT deliveries_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'PICKED_UP'::text, 'DELIVERED'::text, 'CANCELLED'::text])))
);


--
-- Name: dispute_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_evidence (
    id text NOT NULL,
    dispute_id text NOT NULL,
    owner_id text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    storage_provider text NOT NULL,
    storage_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id text NOT NULL,
    booking_id text NOT NULL,
    opened_by text NOT NULL,
    reason_code text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    return_status text DEFAULT 'NONE'::text NOT NULL,
    resolution text,
    refund_kobo integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    reservation_remaining_ms bigint
);


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    user_id text NOT NULL,
    vehicle_type text NOT NULL,
    plate_number text NOT NULL,
    licence_number text NOT NULL,
    city text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    reason text,
    online boolean DEFAULT false NOT NULL,
    latitude double precision,
    longitude double precision,
    location_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT drivers_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUSPENDED'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id text NOT NULL,
    booking_id text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id text,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: favourites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favourites (
    buyer_id text NOT NULL,
    seller_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: funding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funding (
    id text NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    amount_kobo integer NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    checkout_url text,
    provider_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT funding_amount_kobo_check CHECK ((amount_kobo > 0))
);


--
-- Name: idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency (
    actor_id text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response jsonb NOT NULL
);


--
-- Name: ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger (
    id text NOT NULL,
    txn_id text NOT NULL,
    account text NOT NULL,
    owner_id text,
    amount_kobo bigint NOT NULL,
    reference text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_variants (
    id text NOT NULL,
    listing_id text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    price_kobo integer NOT NULL,
    min_quantity integer DEFAULT 1 NOT NULL,
    stock integer NOT NULL,
    wholesale_tiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT listing_variants_min_quantity_check CHECK ((min_quantity > 0)),
    CONSTRAINT listing_variants_price_kobo_check CHECK ((price_kobo > 0)),
    CONSTRAINT listing_variants_stock_check CHECK ((stock >= 0))
);


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id text NOT NULL,
    seller_id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    unit text NOT NULL,
    price_kobo integer NOT NULL,
    stock integer NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    image_url text,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    image_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    available_from timestamp with time zone,
    preorder_capacity integer DEFAULT 0 NOT NULL,
    CONSTRAINT listings_preorder_capacity_check CHECK ((preorder_capacity >= 0)),
    CONSTRAINT listings_price_kobo_check CHECK ((price_kobo > 0)),
    CONSTRAINT listings_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text]))),
    CONSTRAINT listings_stock_check CHECK ((stock >= 0))
);


--
-- Name: location_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_history (
    id text NOT NULL,
    seller_id text NOT NULL,
    actor_id text NOT NULL,
    before_data jsonb NOT NULL,
    after_data jsonb NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.markets (
    id text NOT NULL,
    name text NOT NULL,
    city text NOT NULL,
    area text NOT NULL,
    latitude double precision,
    longitude double precision,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media (
    id text NOT NULL,
    owner_id text NOT NULL,
    url text NOT NULL,
    thumbnail_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    storage_provider text DEFAULT 'local'::text NOT NULL,
    storage_key text,
    thumbnail_key text
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id text NOT NULL,
    conversation_id text NOT NULL,
    sender_id text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id text NOT NULL,
    notification_id text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id text NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    booking_id text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otp_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_challenges (
    id text NOT NULL,
    email text NOT NULL,
    purpose text NOT NULL,
    user_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    send_count integer DEFAULT 1 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_attempts (
    id text NOT NULL,
    funding_reference text NOT NULL,
    provider text NOT NULL,
    status text NOT NULL,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payout_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_accounts (
    id text NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    bank_code text NOT NULL,
    bank_name text NOT NULL,
    account_last4 text NOT NULL,
    account_cipher text NOT NULL,
    account_name text NOT NULL,
    recipient_code text,
    name_match boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id text NOT NULL,
    user_id text NOT NULL,
    account_id text NOT NULL,
    amount_kobo bigint NOT NULL,
    fee_kobo bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    provider text,
    provider_id text,
    failure_reason text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payouts_amount_kobo_check CHECK ((amount_kobo > 0)),
    CONSTRAINT payouts_fee_kobo_check CHECK ((fee_kobo >= 0)),
    CONSTRAINT payouts_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'PROCESSING'::text, 'PAID'::text, 'FAILED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id text NOT NULL,
    listing_id text NOT NULL,
    seller_id text NOT NULL,
    days integer NOT NULL,
    fee_kobo bigint NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    cancel_reason text,
    refund_kobo bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotions_days_check CHECK (((days >= 1) AND (days <= 60))),
    CONSTRAINT promotions_fee_kobo_check CHECK ((fee_kobo >= 0)),
    CONSTRAINT promotions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'CANCELLED'::text])))
);


--
-- Name: push_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_outbox (
    id text NOT NULL,
    notification_id text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    token text NOT NULL,
    user_id text NOT NULL,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    id text NOT NULL,
    booking_id text NOT NULL,
    buyer_id text NOT NULL,
    seller_id text NOT NULL,
    score integer NOT NULL,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ratings_score_check CHECK (((score >= 1) AND (score <= 5)))
);


--
-- Name: reconciliation_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_exceptions (
    id text NOT NULL,
    funding_id text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id text NOT NULL,
    reporter_id text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: seller_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_documents (
    id text NOT NULL,
    seller_id text NOT NULL,
    kind text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    storage_provider text NOT NULL,
    storage_key text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    review_note text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    subject text DEFAULT 'seller'::text NOT NULL,
    CONSTRAINT seller_documents_kind_check CHECK ((kind = ANY (ARRAY['government_id'::text, 'business_registration'::text, 'proof_of_address'::text, 'drivers_licence'::text, 'vehicle_registration'::text, 'other'::text]))),
    CONSTRAINT seller_documents_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'REJECTED'::text]))),
    CONSTRAINT seller_documents_subject_check CHECK ((subject = ANY (ARRAY['seller'::text, 'driver'::text])))
);


--
-- Name: sellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sellers (
    user_id text NOT NULL,
    business_name text NOT NULL,
    business_type text NOT NULL,
    city text NOT NULL,
    area text NOT NULL,
    address text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude double precision,
    longitude double precision,
    public_latitude double precision,
    public_longitude double precision,
    market_id text,
    CONSTRAINT sellers_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUSPENDED'::text])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token_hash text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    refresh_hash text,
    refresh_expires_at timestamp with time zone,
    device_label text DEFAULT 'Unknown device'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    reservation_hours integer NOT NULL,
    commission_bps integer NOT NULL,
    payout_min_kobo integer DEFAULT 100000 NOT NULL,
    payout_fee_kobo integer DEFAULT 5000 NOT NULL,
    promotion_daily_kobo integer DEFAULT 50000 NOT NULL,
    delivery_commission_bps integer DEFAULT 1000 NOT NULL,
    delivery_radius_km integer DEFAULT 15 NOT NULL,
    pay_on_delivery_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT settings_id_check CHECK ((id = 1))
);


--
-- Name: stock_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_alerts (
    buyer_id text NOT NULL,
    listing_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    blocker_id text NOT NULL,
    blocked_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    password_hash text NOT NULL,
    admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email_verified_at timestamp with time zone,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    staff_role text,
    CONSTRAINT users_staff_role_check CHECK ((staff_role = ANY (ARRAY['owner'::text, 'operations'::text, 'finance'::text, 'support'::text])))
);


--
-- Name: vehicle_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_types (
    code text NOT NULL,
    name text NOT NULL,
    base_fare_kobo integer NOT NULL,
    per_km_kobo integer NOT NULL,
    min_fare_kobo integer NOT NULL,
    max_km integer DEFAULT 30 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    CONSTRAINT vehicle_types_base_fare_kobo_check CHECK ((base_fare_kobo >= 0)),
    CONSTRAINT vehicle_types_min_fare_kobo_check CHECK ((min_fare_kobo >= 0)),
    CONSTRAINT vehicle_types_per_km_kobo_check CHECK ((per_km_kobo >= 0))
);


--
-- Name: worker_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_heartbeats (
    name text NOT NULL,
    beat_at timestamp with time zone NOT NULL,
    last_error text
);


--
-- Name: audit audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: consumed_refresh_tokens consumed_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumed_refresh_tokens
    ADD CONSTRAINT consumed_refresh_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: conversations conversations_buyer_id_seller_id_listing_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_buyer_id_seller_id_listing_id_key UNIQUE (buyer_id, seller_id, listing_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);


--
-- Name: dispute_evidence dispute_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_booking_id_key UNIQUE (booking_id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (user_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: favourites favourites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourites
    ADD CONSTRAINT favourites_pkey PRIMARY KEY (buyer_id, seller_id);


--
-- Name: funding funding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding
    ADD CONSTRAINT funding_pkey PRIMARY KEY (id);


--
-- Name: idempotency idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency
    ADD CONSTRAINT idempotency_pkey PRIMARY KEY (actor_id, key);


--
-- Name: ledger ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);


--
-- Name: listing_variants listing_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_variants
    ADD CONSTRAINT listing_variants_pkey PRIMARY KEY (id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: location_history location_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_history
    ADD CONSTRAINT location_history_pkey PRIMARY KEY (id);


--
-- Name: markets markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: media media_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_url_key UNIQUE (url);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notification_outbox notification_outbox_notification_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_notification_id_key UNIQUE (notification_id);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: otp_challenges otp_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT otp_challenges_pkey PRIMARY KEY (id);


--
-- Name: payment_attempts payment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_pkey PRIMARY KEY (id);


--
-- Name: payout_accounts payout_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: push_outbox push_outbox_notification_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_outbox
    ADD CONSTRAINT push_outbox_notification_id_key UNIQUE (notification_id);


--
-- Name: push_outbox push_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_outbox
    ADD CONSTRAINT push_outbox_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (token);


--
-- Name: ratings ratings_booking_id_buyer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_booking_id_buyer_id_key UNIQUE (booking_id, buyer_id);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_exceptions reconciliation_exceptions_funding_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_exceptions
    ADD CONSTRAINT reconciliation_exceptions_funding_id_key UNIQUE (funding_id);


--
-- Name: reconciliation_exceptions reconciliation_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_exceptions
    ADD CONSTRAINT reconciliation_exceptions_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: seller_documents seller_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_documents
    ADD CONSTRAINT seller_documents_pkey PRIMARY KEY (id);


--
-- Name: sellers sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_pkey PRIMARY KEY (user_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: sessions sessions_refresh_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_refresh_hash_key UNIQUE (refresh_hash);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: stock_alerts stock_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_pkey PRIMARY KEY (buyer_id, listing_id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicle_types vehicle_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_types
    ADD CONSTRAINT vehicle_types_pkey PRIMARY KEY (code);


--
-- Name: worker_heartbeats worker_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_heartbeats
    ADD CONSTRAINT worker_heartbeats_pkey PRIMARY KEY (name);


--
-- Name: audit_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_created_idx ON public.audit USING btree (created_at DESC, id DESC);


--
-- Name: bookings_buyer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_buyer_idx ON public.bookings USING btree (buyer_id);


--
-- Name: bookings_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_created_idx ON public.bookings USING btree (created_at DESC, id DESC);


--
-- Name: bookings_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_expiry_idx ON public.bookings USING btree (reserved_until) WHERE (status = ANY (ARRAY['ACCEPTED'::text, 'READY_FOR_PICKUP'::text]));


--
-- Name: bookings_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_seller_idx ON public.bookings USING btree (seller_id);


--
-- Name: deliveries_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deliveries_active_idx ON public.deliveries USING btree (booking_id) WHERE (status = ANY (ARRAY['OPEN'::text, 'ASSIGNED'::text, 'PICKED_UP'::text, 'DELIVERED'::text]));


--
-- Name: deliveries_driver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deliveries_driver_idx ON public.deliveries USING btree (driver_id, created_at);


--
-- Name: deliveries_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deliveries_open_idx ON public.deliveries USING btree (status) WHERE (status = 'OPEN'::text);


--
-- Name: events_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_booking_idx ON public.events USING btree (booking_id);


--
-- Name: events_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_completed_idx ON public.events USING btree (booking_id) WHERE (to_status = 'COMPLETED'::text);


--
-- Name: favourites_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourites_seller_idx ON public.favourites USING btree (seller_id);


--
-- Name: ledger_balance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_balance_idx ON public.ledger USING btree (owner_id, account);


--
-- Name: ledger_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_created_idx ON public.ledger USING btree (created_at DESC, id DESC);


--
-- Name: listings_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_seller_idx ON public.listings USING btree (seller_id);


--
-- Name: messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_idx ON public.messages USING btree (conversation_id, created_at);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, created_at);


--
-- Name: otp_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_email_idx ON public.otp_challenges USING btree (email, created_at);


--
-- Name: payout_accounts_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payout_accounts_active_idx ON public.payout_accounts USING btree (user_id) WHERE active;


--
-- Name: payouts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_status_idx ON public.payouts USING btree (status);


--
-- Name: payouts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_user_idx ON public.payouts USING btree (user_id, created_at);


--
-- Name: promotions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_active_idx ON public.promotions USING btree (listing_id, ends_at) WHERE (status = 'ACTIVE'::text);


--
-- Name: push_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_outbox_pending_idx ON public.push_outbox USING btree (available_at) WHERE (status = 'PENDING'::text);


--
-- Name: push_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_tokens_user_idx ON public.push_tokens USING btree (user_id) WHERE (disabled_at IS NULL);


--
-- Name: seller_documents_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_documents_seller_idx ON public.seller_documents USING btree (seller_id);


--
-- Name: seller_public_geo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_public_geo_idx ON public.sellers USING btree (public_latitude, public_longitude);


--
-- Name: sessions_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_id_idx ON public.sessions USING btree (id);


--
-- Name: stock_alerts_listing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_alerts_listing_idx ON public.stock_alerts USING btree (listing_id);


--
-- Name: variants_listing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX variants_listing_idx ON public.listing_variants USING btree (listing_id);


--
-- Name: variants_primary_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX variants_primary_idx ON public.listing_variants USING btree (listing_id) WHERE is_primary;


--
-- Name: audit audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: bookings bookings_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: bookings bookings_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);


--
-- Name: bookings bookings_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(user_id);


--
-- Name: bookings bookings_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.listing_variants(id);


--
-- Name: conversations conversations_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: conversations conversations_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);


--
-- Name: conversations conversations_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(user_id);


--
-- Name: deliveries deliveries_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: deliveries deliveries_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: deliveries deliveries_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id);


--
-- Name: deliveries deliveries_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: deliveries deliveries_vehicle_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_vehicle_type_fkey FOREIGN KEY (vehicle_type) REFERENCES public.vehicle_types(code);


--
-- Name: dispute_evidence dispute_evidence_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes(id);


--
-- Name: dispute_evidence dispute_evidence_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: disputes disputes_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: disputes disputes_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id);


--
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: drivers drivers_vehicle_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_vehicle_type_fkey FOREIGN KEY (vehicle_type) REFERENCES public.vehicle_types(code);


--
-- Name: events events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: events events_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: favourites favourites_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourites
    ADD CONSTRAINT favourites_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: favourites favourites_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourites
    ADD CONSTRAINT favourites_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(user_id);


--
-- Name: funding funding_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding
    ADD CONSTRAINT funding_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: listing_variants listing_variants_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_variants
    ADD CONSTRAINT listing_variants_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);


--
-- Name: listings listings_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(user_id);


--
-- Name: location_history location_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_history
    ADD CONSTRAINT location_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: location_history location_history_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_history
    ADD CONSTRAINT location_history_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(user_id);


--
-- Name: media media_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: notification_outbox notification_outbox_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payout_accounts payout_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_accounts
    ADD CONSTRAINT payout_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payouts payouts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.payout_accounts(id);


--
-- Name: payouts payouts_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: payouts payouts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: promotions promotions_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);


--
-- Name: promotions promotions_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: push_outbox push_outbox_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_outbox
    ADD CONSTRAINT push_outbox_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ratings ratings_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: ratings ratings_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: ratings ratings_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(user_id);


--
-- Name: reconciliation_exceptions reconciliation_exceptions_funding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_exceptions
    ADD CONSTRAINT reconciliation_exceptions_funding_id_fkey FOREIGN KEY (funding_id) REFERENCES public.funding(id);


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: seller_documents seller_documents_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_documents
    ADD CONSTRAINT seller_documents_owner_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: seller_documents seller_documents_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_documents
    ADD CONSTRAINT seller_documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: sellers sellers_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);


--
-- Name: sellers sellers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: stock_alerts stock_alerts_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: stock_alerts stock_alerts_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id);


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id);


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--


-- Reference data
INSERT INTO public.settings VALUES (1, 168, 500, 100000, 5000, 50000, 1000, 15, false);
INSERT INTO public.vehicle_types VALUES ('bicycle', 'Bicycle', 30000, 10000, 50000, 8, true, 1);
INSERT INTO public.vehicle_types VALUES ('motorcycle', 'Motorcycle (okada)', 50000, 15000, 80000, 30, true, 2);
INSERT INTO public.vehicle_types VALUES ('tricycle', 'Tricycle (keke)', 70000, 20000, 120000, 25, true, 3);
INSERT INTO public.vehicle_types VALUES ('car', 'Car', 100000, 25000, 180000, 40, true, 4);
INSERT INTO public.vehicle_types VALUES ('van', 'Van / pickup truck', 250000, 40000, 400000, 60, true, 5);
