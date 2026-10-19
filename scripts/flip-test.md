# Private BIN flip scanner test

Runs separately from the bot. No public commands, Discord posts, AI, browser,
sales-price dependency, database writes or schema migration. Uses the existing
`PRICE_DATABASE_URL` data and the repository's `pg` dependency. Node 22+.

## Run

From the Futbot repository, with dependencies installed (`npm ci`):

```bash
node --env-file=.env scripts/flip-test.mjs --once
node --env-file=.env scripts/flip-test.mjs
```

On a hosted service that supplies environment variables, omit `--env-file=.env`.
The first command runs a single check. The second checks every 15 minutes.
Alternatively schedule `--once` every 15 minutes, using the SAME persistent directory.
Use one service/process only. Existing bot startup is not changed.

Required: `PRICE_DATABASE_URL`. Existing `GAME_YEAR` (default 27) and `PLATFORM`
(default ps5, or pc) are reused. No Discord token or APP database is needed.

Optional:

```dotenv
FLIP_TEST_MAX_CARDS=300
FLIP_TEST_DIR=/data/flip-test
```

Mount a persistent volume at `/data/flip-test` on Coolify/Railway. Without a volume,
redeployments can lose history and restart warm-up. Default is `.flip-test` in the
working directory; keep it outside Git. State is separated by year and platform.

## Cost and scope

- One read-only, eight-second-timeout SQL query per check (96/day), one connection.
- Once a day, discover eligible cards: current BIN **strictly above 20,000 OR rating
  strictly above 85** (86+). A stable hash selects up to 300 to bound cost; this
  test samples the eligible universe and does not monitor every qualifying card.
  Increase cap explicitly if needed (20–1000).
- Between discoveries only those selected card IDs are queried. Newly qualifying
  cards can take up to a day to enter the sample. Keep selected cards in the basket
  until next discovery even if their price falls through 20k; new signals always
  require the filter to pass at that moment.
- Fetch only latest stored prices, never scan/reload the full historical table.
  Build a local seven-day history of hourly medians plus three recent observations.
- State and call records are pruned to seven days. No generated charts or images.
- A candidate log is capped at five per check and one per card per 24 hours.
- Daily discovery still probes active cards. Existing lookup indexes are important:
  see `ops/price-market-indexes.sql`, or `ops/price-market-pc-index.sql` for PC.
  Ask the database owner to install these if absent; the test does not create them.
  A timeout fails the scan instead of launching heavier retries.

## Rules being tested (unvalidated starting thresholds)

No candidates during warm-up: require three prior 24-hour windows with at least
18 observed hours each. Realistically allow 3–4 days with a healthy price feed.
No historical backfill is performed to keep startup cheap.

Require three distinct timestamped fresh observations spanning at least 20 minutes,
near the historical lower quintile, at least 6% below the typical price. Ignore
isolated spikes, large discontinuities and unstable dips. Reject a >3% fall in
either successive daily median. Require at least three separate historical dips
followed by two hourly observations at the target within 12 hours.

Target is the weakest of the three daily upper quartiles, minus a 2% buffer.
Entry uses the highest of the three confirmation prices. Deduct 5% tax; require
at least 1,500 coins and 5% estimated net return. These are experiment settings,
not proven success probabilities or promises of executable prices.

Market guard uses equal-weight card percentage changes against their prior
1–3 hour observations. Pause for two hours when median fall is at least 4% and
60% of the matched sample falls at least 4%. Require at least 20 matched cards,
70% historical market coverage and 80% fresh coverage of the selected basket.
Insufficient coverage also pauses calls. This detects broad moves in the monitored
sample; category-only crashes, unexpected events and slow declines can escape it.
It cannot anticipate leaks/news. Stop the service to pause manually.

Source freshness uses `captured_at`, the timestamp currently exposed by Futbot's
price tables. Duplicate timestamps never count as new observations. If an upstream
worker inserts old quotes with new capture times, this script cannot establish the
original quote age: fix that upstream rather than treating repeated prices as proof.

## Results

Each run prints JSON to private service logs and replaces `latest.json`. `state.json`
contains seven days of bounded history and calls, under `<FLIP_TEST_DIR>/<year>-<platform>`.
Check `paused`, `pauseReason`, `market`, rejection `reasons`, `signals` and `outcomes`.
Calls expire after 12 hours. `target_observed` requires two later fresh readings at
or above the target, at least ten minutes apart, before expiry. It is **not** a
completed sale or realised profit. Missing/stale data cannot prove trade failure;
`expired` means the target was not confirmed in the collected data.

The script never posts to Discord, so only people with access to these private
files/service logs can see the test. No automatic/public rollout is enabled.
Thresholds need evaluation against the collected results before using calls live.

If a process is killed abruptly, `scanner.lock` may remain. Stop/verify that no
scanner is running, then remove that one lock file before restarting. Never delete
a live process's lock. Malformed state fails closed; preserve it for investigation.

## Verify

```bash
node --test scripts/flip-test.test.mjs
```

Tests cover eligibility boundaries, repeatable recoveries, outliers, stale and
duplicate observations, falling trends, broad crash pauses, deduplication, and
target expiry. They use synthetic data and do not establish trading accuracy.
