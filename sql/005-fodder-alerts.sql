CREATE TABLE IF NOT EXISTS futbot_fodder_alerts (
 id bigserial PRIMARY KEY,
 user_id text NOT NULL,
 game_year smallint NOT NULL,
 platform text NOT NULL CHECK(platform IN ('ps5','pc')),
 rating smallint NOT NULL CHECK(rating BETWEEN 75 AND 99),
 baseline_price integer NOT NULL CHECK(baseline_price>0),
 drop_percent numeric(5,2) NOT NULL CHECK(drop_percent>0 AND drop_percent<=50),
 target_price integer NOT NULL CHECK(target_price>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','queued','triggered','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 triggered_at timestamptz,
 last_error text
);
CREATE INDEX IF NOT EXISTS futbot_fodder_alert_user_idx ON futbot_fodder_alerts(user_id,state);
CREATE INDEX IF NOT EXISTS futbot_fodder_alert_active_idx ON futbot_fodder_alerts(game_year,platform,rating) WHERE state='active';
