-- Retire the experimental leak scanner and remote EA browser data.
-- The application schema runner executes SQL files on every migration run.
DROP TABLE IF EXISTS futbot_ea_browser_commands;
DROP TABLE IF EXISTS futbot_ea_browser;
DROP TABLE IF EXISTS futbot_content_watch;
