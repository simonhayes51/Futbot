CREATE TABLE IF NOT EXISTS futbot_ea_browser (
 game_year smallint PRIMARY KEY,
 phase text NOT NULL DEFAULT 'disconnected',
 auto_enabled boolean NOT NULL DEFAULT false,
 heartbeat_at timestamptz,
 interactive_until timestamptz,
 frame_cipher text,
 frame_at timestamptz,
 last_scan_at timestamptz,
 last_error text
);
CREATE TABLE IF NOT EXISTS futbot_ea_browser_commands (
 id uuid PRIMARY KEY,
 game_year smallint NOT NULL,
 action text NOT NULL,
 payload_cipher text,
 state text NOT NULL DEFAULT 'pending',
 queued_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 completed_at timestamptz,
 error text
);
CREATE INDEX IF NOT EXISTS futbot_ea_commands_pending_idx ON futbot_ea_browser_commands(game_year,queued_at) WHERE state='pending';
