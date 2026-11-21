ALTER TABLE listings ADD COLUMN pickup_available boolean NOT NULL DEFAULT true, ADD COLUMN delivery_available boolean NOT NULL DEFAULT true, ADD CONSTRAINT listing_fulfilment_required CHECK(pickup_available OR delivery_available);
ALTER TABLE bookings ADD COLUMN pickup_available boolean NOT NULL DEFAULT true, ADD COLUMN delivery_available boolean NOT NULL DEFAULT true;
