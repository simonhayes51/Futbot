CREATE TABLE IF NOT EXISTS futbot_flip_channels (
 guild_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('ps5','pc')),
 channel_id text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 set_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,platform)
);
CREATE TABLE IF NOT EXISTS futbot_flip_outbox (
 signal_key text NOT NULL, guild_id text NOT NULL, channel_id text NOT NULL,
 game_year integer NOT NULL, platform text NOT NULL CHECK(platform IN ('ps5','pc')),
 signal jsonb NOT NULL, source_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','posting','sent','cancelled','failed')),
 attempts integer NOT NULL DEFAULT 0, posting_at timestamptz, message_id text,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(signal_key,guild_id)
);
CREATE INDEX IF NOT EXISTS futbot_flip_outbox_pending ON futbot_flip_outbox(state,created_at);
