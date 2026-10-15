CREATE TABLE IF NOT EXISTS futbot_watchlist (
 user_id text NOT NULL,card_id bigint NOT NULL,game_year smallint NOT NULL,platform text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,card_id,game_year,platform)
);
CREATE TABLE IF NOT EXISTS futbot_sessions (
 session_hash text PRIMARY KEY,user_id text NOT NULL,profile jsonb NOT NULL,token_cipher text NOT NULL,
 csrf text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS futbot_sessions_expiry_idx ON futbot_sessions(expires_at);
CREATE TABLE IF NOT EXISTS futbot_audit (
 id bigserial PRIMARY KEY,guild_id text NOT NULL,user_id text NOT NULL,action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
