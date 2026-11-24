-- "Request what you need" with the details a seller needs to quote: how much, by when, a budget,
-- and where (sellers around that spot are alerted). Sellers quote a price per unit, and the buyer
-- can order at that price.
ALTER TABLE product_requests ADD COLUMN quantity numeric;
ALTER TABLE product_requests ADD COLUMN unit text;
ALTER TABLE product_requests ADD COLUMN budget_kobo integer;
ALTER TABLE product_requests ADD COLUMN needed_by date;
ALTER TABLE product_requests ADD COLUMN area text;
ALTER TABLE product_requests ADD COLUMN radius_km integer NOT NULL DEFAULT 10;
ALTER TABLE product_request_sellers ADD COLUMN distance_km double precision;
ALTER TABLE product_request_offers ADD COLUMN price_kobo integer;
ALTER TABLE product_request_offers ADD COLUMN quantity numeric;
ALTER TABLE bookings ADD COLUMN request_offer_id text REFERENCES product_request_offers(id);
