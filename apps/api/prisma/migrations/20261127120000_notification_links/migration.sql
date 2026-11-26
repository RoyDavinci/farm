-- Where a notification leads when tapped: "booking:<id>", "planner:<plan id>", "drive",
-- "sell:requests", "account:requests", "home:groups", "listing:<id>", "wallet", "messages"…
ALTER TABLE notifications ADD COLUMN link text;
-- Earlier notifications: their order, else the usual place for their kind.
UPDATE notifications SET link = CASE
  WHEN booking_id IS NOT NULL THEN 'booking:' || booking_id
  WHEN kind IN ('planner','plan','report') THEN 'planner'
  WHEN kind = 'message' THEN 'messages'
  WHEN kind = 'shopping' THEN 'riders'
  WHEN kind IN ('payment','payout') THEN 'wallet'
  WHEN kind = 'group_buy' THEN 'home:groups'
  WHEN kind IN ('request','price_alert','stock') THEN 'account:requests'
  WHEN kind IN ('promotion','rfq','listing') THEN 'sell'
  WHEN kind = 'team' THEN 'business'
  WHEN kind IN ('security','verification','subscription') THEN 'account'
  WHEN kind = 'dispute' THEN 'orders'
  WHEN kind IN ('local_digest','marketing') THEN 'home'
  ELSE NULL END
WHERE link IS NULL;
