ALTER TABLE futbot_feeds
  DROP CONSTRAINT IF EXISTS futbot_feeds_kind_check;

ALTER TABLE futbot_feeds
  ADD CONSTRAINT futbot_feeds_kind_check
  CHECK (kind IN ('fodder','movers','watchlist','summary','consumables'));
