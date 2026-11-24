-- One rider per errand: a basket from a second (third…) shop rides along on the first shop's
-- delivery as an extra stop, priced for the extra distance only. It is never offered on its
-- own; whoever takes the lead delivery gets the whole trip.
ALTER TABLE deliveries ADD COLUMN trip_lead_id text REFERENCES deliveries(id);
CREATE INDEX deliveries_trip_lead_idx ON deliveries(trip_lead_id) WHERE trip_lead_id IS NOT NULL;
