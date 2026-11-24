-- "Request it" for any kind of product: the details that matter beyond the name (brand, model,
-- size, colour), new or used, and how far the search had to go to find sellers.
ALTER TABLE product_requests ADD COLUMN details text;
ALTER TABLE product_requests ADD COLUMN condition text;
ALTER TABLE product_requests ADD COLUMN reach_km int;
-- Sellers who list a matching product after the request was made are alerted too.
ALTER TABLE product_request_sellers ADD COLUMN late boolean NOT NULL DEFAULT false;
