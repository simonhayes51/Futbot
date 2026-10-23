CREATE TABLE IF NOT EXISTS futbot_content_watch (
 game_year smallint PRIMARY KEY,
 state jsonb NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now()
);
