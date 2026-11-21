ALTER TABLE deliveries ADD COLUMN pricing jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX delivery_tariffs_area_case_idx ON delivery_tariffs(lower(state),lower(city),vehicle_type);
