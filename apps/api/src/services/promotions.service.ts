/** SQL condition: listing alias `l` has a running sponsored placement. */
export const activePromotion =
  "EXISTS(SELECT 1 FROM promotions p WHERE p.listing_id=l.id AND p.status='ACTIVE' AND p.starts_at<=now() AND p.ends_at>now())";
