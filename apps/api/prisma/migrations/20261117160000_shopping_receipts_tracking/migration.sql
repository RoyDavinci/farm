ALTER TABLE shopping_requests ADD COLUMN receipt_photos JSONB NOT NULL DEFAULT '[]',
ADD COLUMN rider_latitude DOUBLE PRECISION, ADD COLUMN rider_longitude DOUBLE PRECISION,
ADD COLUMN rider_location_at TIMESTAMP(3);
ALTER TABLE shopping_requests ADD CONSTRAINT shopping_location_pair CHECK (
(rider_latitude IS NULL AND rider_longitude IS NULL) OR
(rider_latitude IS NOT NULL AND rider_longitude IS NOT NULL AND rider_latitude BETWEEN -90 AND 90 AND rider_longitude BETWEEN -180 AND 180));
