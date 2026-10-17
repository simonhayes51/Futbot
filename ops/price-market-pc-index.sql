-- Optional: run only if public.futbot_pc_bin_history exists.
-- Use the FutBot PRICE database owner/admin, autocommit, not APP_DATABASE_URL.

CREATE INDEX CONCURRENTLY IF NOT EXISTS futbot_market_pc_bin_lookup_idx
    ON public.futbot_pc_bin_history
       (game_year, platform, source_card_id, captured_at DESC, id DESC)
    INCLUDE (lowest_bin)
    WHERE lowest_bin > 0;

ANALYZE public.futbot_pc_bin_history;
