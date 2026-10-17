CREATE TABLE IF NOT EXISTS futbot_misc_watchlist (
  user_id text NOT NULL,
  game_year smallint NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ps5','pc')),
  item_type text NOT NULL CHECK (item_type IN ('manager','manager_league','chemistry_style')),
  item_id bigint NOT NULL,
  starting_price integer CHECK (starting_price IS NULL OR starting_price > 0),
  watched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,game_year,platform,item_type,item_id)
);
CREATE INDEX IF NOT EXISTS futbot_misc_watchlist_user_idx
  ON futbot_misc_watchlist(user_id,game_year,platform);

CREATE TABLE IF NOT EXISTS futbot_misc_alerts (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  game_year smallint NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ps5','pc')),
  item_type text NOT NULL CHECK (item_type IN ('manager','manager_league','chemistry_style')),
  item_id bigint NOT NULL,
  item_label text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('below','above')),
  target_price integer NOT NULL CHECK (target_price BETWEEN 1 AND 15000000),
  baseline_price integer NOT NULL CHECK (baseline_price BETWEEN 1 AND 15000000),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','queued','triggered','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  triggered_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS futbot_misc_alert_user_idx
  ON futbot_misc_alerts(user_id,state,created_at DESC);
CREATE INDEX IF NOT EXISTS futbot_misc_alert_active_idx
  ON futbot_misc_alerts(game_year,platform,item_type,item_id)
  WHERE state='active';
