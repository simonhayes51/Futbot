-- Application database only. Existing alerts and watchlists are retained.
CREATE TABLE IF NOT EXISTS futbot_subscriptions (
 scope text NOT NULL CHECK(scope IN ('user','guild')),scope_id text NOT NULL,owner_id text NOT NULL,
 plan text NOT NULL,status text NOT NULL DEFAULT 'incomplete',customer_id text,subscription_id text UNIQUE,
 paid_until timestamptz,cancel_at_period_end boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(scope,scope_id)
);
CREATE TABLE IF NOT EXISTS futbot_checkout (
 scope text NOT NULL,scope_id text NOT NULL,owner_id text NOT NULL,plan text NOT NULL,session_id text UNIQUE,url text,expires_at timestamptz,
 PRIMARY KEY(scope,scope_id)
);
CREATE TABLE IF NOT EXISTS futbot_stripe_events (id text PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS futbot_seats (guild_id text NOT NULL,user_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS futbot_shared_lists (
 id bigserial PRIMARY KEY,guild_id text NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS futbot_shared_guild_idx ON futbot_shared_lists(guild_id);
CREATE TABLE IF NOT EXISTS futbot_shared_cards (
 list_id bigint NOT NULL REFERENCES futbot_shared_lists(id) ON DELETE CASCADE,card_id bigint NOT NULL,
 game_year smallint NOT NULL,platform text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(list_id,card_id,game_year,platform)
);
CREATE TABLE IF NOT EXISTS futbot_feeds (
 id bigserial PRIMARY KEY,guild_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('fodder','movers','watchlist','summary','consumables')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),channel_id text NOT NULL,role_id text,
 timezone text NOT NULL DEFAULT 'Europe/London',times jsonb NOT NULL DEFAULT '["18:05"]',
 list_id bigint REFERENCES futbot_shared_lists(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,next_run_at timestamptz NOT NULL,last_hash text,last_prices jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS futbot_feeds_due_idx ON futbot_feeds(next_run_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS futbot_feed_runs (
 id bigserial PRIMARY KEY,feed_id bigint NOT NULL REFERENCES futbot_feeds(id) ON DELETE CASCADE,
 slot timestamptz NOT NULL,state text NOT NULL CHECK(state IN ('sending','posted','skipped','failed','uncertain')),
 detail text NOT NULL DEFAULT '',message_id text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(feed_id,slot)
);
