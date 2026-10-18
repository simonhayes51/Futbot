CREATE TABLE IF NOT EXISTS futbot_trade_posts (
 id bigserial PRIMARY KEY,
 guild_id text NOT NULL,
 user_id text NOT NULL,
 channel_id text NOT NULL,
 card_id text NOT NULL,
 card_name text NOT NULL,
 game_year smallint NOT NULL,
 platform text NOT NULL CHECK(platform IN ('ps5','pc')),
 trigger_type text NOT NULL CHECK(trigger_type IN ('price','drop_pct')),
 trigger_value numeric NOT NULL CHECK(trigger_value>0),
 baseline_price integer NOT NULL CHECK(baseline_price>0),
 buy_price integer NOT NULL CHECK(buy_price>0),
 sell_price integer CHECK(sell_price IS NULL OR sell_price>buy_price),
 note text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','posting','posted','cancelled','failed')),
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_checked_at timestamptz,
 posting_at timestamptz,
 triggered_at timestamptz,
 message_id text,
 last_error text
);
CREATE INDEX IF NOT EXISTS futbot_trade_posts_due_idx ON futbot_trade_posts(state,created_at) WHERE state IN ('active','posting');
CREATE INDEX IF NOT EXISTS futbot_trade_posts_owner_idx ON futbot_trade_posts(guild_id,user_id,created_at DESC);
