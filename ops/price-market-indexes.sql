-- Run as the owner/admin of the FutBot PRICE database, not APP_DATABASE_URL.
-- Keep each statement in autocommit: CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction. This covering index matches the console latest-price
-- and 24-25 hour baseline probes in src/market.ts.

CREATE INDEX CONCURRENTLY IF NOT EXISTS futbot_market_bin_lookup_idx
    ON public.futgg_bin_history
       (game_year, platform, source_card_id, captured_at DESC, id DESC)
    INCLUDE (lowest_bin)
    WHERE lowest_bin > 0;

ANALYZE public.futgg_bin_history;
