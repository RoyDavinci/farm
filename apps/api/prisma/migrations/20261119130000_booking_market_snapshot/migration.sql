ALTER TABLE bookings ADD COLUMN pickup_market_id text REFERENCES markets(id);
