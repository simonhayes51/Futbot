-- Run ONLY against APP_DATABASE_URL, never the price source database.
CREATE TABLE IF NOT EXISTS futbot_alerts (
 id bigserial PRIMARY KEY,user_id text NOT NULL,guild_id text,card_id bigint NOT NULL,
 card_name text NOT NULL,game_year smallint NOT NULL DEFAULT 27,platform text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('below','above')),target bigint NOT NULL CHECK(target>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','queued','triggered','paused','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),triggered_at timestamptz
);
CREATE INDEX IF NOT EXISTS futbot_alert_user_idx ON futbot_alerts(user_id,state);
CREATE TABLE IF NOT EXISTS futbot_outbox (
 id bigserial PRIMARY KEY,alert_id bigint NOT NULL UNIQUE REFERENCES futbot_alerts(id),
 observed_price bigint NOT NULL,captured_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending',retry_at timestamptz NOT NULL DEFAULT now(),last_error text
);
CREATE TABLE IF NOT EXISTS futbot_guilds (
 guild_id text PRIMARY KEY,name text NOT NULL DEFAULT 'FutBot',accent text NOT NULL DEFAULT '#b7f67b',
 footer text NOT NULL DEFAULT 'FutBot • Ultimate Team',settings jsonb NOT NULL DEFAULT '{}'
);
