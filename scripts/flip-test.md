# Private BIN flip scanner test

Runs separately from the bot. It can optionally post live, rule-qualified calls
to one explicitly configured private Discord channel. It has no public commands,
AI, browser, sales-price dependency, database writes or schema migration. Uses the existing
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
(default ps5, or pc) are reused. No APP database is needed.

Discord posting is off unless both of these Railway variables are set:

- `DISCORD_TOKEN`: FutBot's existing bot token.
- `FLIP_TEST_DISCORD_CHANNEL_ID`: ID of the private server text channel.

The target must have an explicit `@everyone` deny for **View Channel**. FutBot
also needs View Channel, Send Messages and Embed Links there. The scanner refuses
to post if the target is public or is not a server text/announcement channel.
It posts only newly generated live `signals`; historical replay examples and
diagnostic runs are never posted. Pending sends are retried, and Discord nonces
prevent duplicate messages if Railway restarts during a send. Keep the scanner's
persistent state directory enabled so cooldowns and its send queue survive restarts.

Optional:

```dotenv
FLIP_TEST_MAX_CARDS=300
FLIP_TEST_DIR=/data/flip-test
```

Mount a persistent volume at `/data/flip-test` on Coolify/Railway. Without a volume,
redeployments can lose history and trigger another initial history load. Default is `.flip-test` in the
working directory; keep it outside Git. State is separated by year and platform.

## Diagnose existing history

Run a one-off coverage report against the existing price history:

```bash
FLIP_TEST_MAX_CARDS=20 FLIP_TEST_DIR=/tmp/flip-probe node scripts/flip-test.mjs --diagnose-history
```

The mode exits after one run, lists each selected card's observed hours in each
24-hour window, strict history failures, and whether three recent observations
span at least 20 minutes. It also compares a hypothetical diagnostic threshold
of 10 hours per window, at most two partial days, and 50 total hours. That
exploratory threshold is coverage math only: it never enters candidate evaluation
or creates signals. The database connection remains read-only; state and report
files are written only under the separate `FLIP_TEST_DIR`.

## Cost and scope

- One read-only, eight-second-timeout SQL query per routine check (96/day), one connection.
- Once a day, discover eligible cards: current BIN **strictly above 20,000 OR rating
  strictly above 85** (86+). A stable hash selects up to 300 to bound cost; this
  test samples the eligible universe and does not monitor every qualifying card.
  Increase cap explicitly if needed (20–1000).
- Between discoveries only those selected card IDs are queried. Newly qualifying
  cards can take up to a day to enter the sample. Keep selected cards in the basket
  until next discovery even if their price falls through 20k; new signals always
  require the filter to pass at that moment.
- On first use, load up to seven days of existing history for selected cards only,
  in sequential batches of 20. Each query aggregates hours in the database and
  returns at most 168 hourly points plus three recent 15-minute-slot observations
  per card. No full-table export or browser scraping.
- Refresh the latest snapshot after loading history, then assess candidates in that
  same run. With sufficient existing data, the first run can produce signals.
- A per-card marker avoids repeating the load on routine checks or restarts.
  Newly selected cards are seeded when discovered; after a gap of more than a day
  in stored local history, the card is seeded again. Existing old-version state is
  upgraded automatically. Missing database history is never fabricated.
- After seeding, build local hourly medians plus three recent observations from
  the latest stored prices. Preserve the state volume to avoid unnecessary loads.
- After a break longer than 25 minutes, fill the missed recent history from the
  database in batches of 20. The default catch-up spans four hours, extends with
  longer breaks and never exceeds seven days. Old state without a last-scan marker
  gets one four-hour refresh. Routine 15-minute checks do not repeat this read.
  Recent confirmation samples also populate the current hourly bucket so they
  remain available to the next hour's market comparison.
- State and call records are pruned to seven days. No generated charts or images.
- A candidate log is capped at five per check and one per card per 24 hours.
- Daily discovery still probes active cards. Existing lookup indexes are important:
  see `ops/price-market-indexes.sql`, or `ops/price-market-pc-index.sql` for PC.
  Ask the database owner to install these if absent; the test does not create them.
  A timeout fails the scan instead of launching heavier retries.

## Rules being tested (unvalidated starting thresholds)

Require at least 54 observed hours across the last 72 hours, at least 12 in each
24-hour window, and at least 18 in two of the three windows. This allows one
partial day without discarding otherwise useful history. These observations
come from existing database history on the first run, rather than waiting days
to collect them. Cards lacking enough existing data are skipped with an explicit
reason while new observations accumulate. Recent confirmation observations are
also seeded from the last hour, so they do not require a new polling cycle when
the stored feed already has enough fresh points. First-run execution time depends
on database size/indexes and the selected cap; live cost has not been measured.

Require three distinct timestamped fresh observations spanning at least 20 minutes,
near the historical lower quintile, at least 6% below the typical price. Ignore
isolated spikes, large discontinuities and unstable dips. Reject a >3% fall in
either successive daily median. Require at least three separate historical dips
followed by two hourly observations at the target within 12 hours.
An episode stops at an observation gap longer than three hours, so a missing
period cannot establish a recovery. Candidates using one partial day are labelled
`one_partial_day` and ranked below candidates with all three days well covered.
This is a data-coverage adjustment, not evidence that predictive accuracy improved.

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

Each run prints a readable trade summary to private service logs and replaces `latest.json`
with the full structured report. The log shows live buy checks separately from
retrospective setups, with card name/version, entry, target, estimated net and
whether the target was later observed, with successful and missed examples shown
separately. `state.json`
contains seven days of bounded history and calls, under `<FLIP_TEST_DIR>/<year>-<platform>`.
Check `historyLoaded`, `historyRefreshed`, `historyCoverage`, `paused`, `pauseReason`, `market`, rejection `reasons`,
`signals`, `outcomes` and `historicalPulls`. `signals` are live-only candidates
that satisfy every current rule. `historicalPulls` replays prior hourly BIN dips
against the preceding 24-hour median and checks target recovery over 12, 24 and
48 hours. The 12-hour window is the original short-term benchmark; 24/48-hour
results show later recoveries separately, so a slow recovery is not labelled a
failure at every horizon. A result is counted only when that whole window has
enough observations. It is a retrospective diagnostic, separate from live calls;
it uses later observations to score an earlier entry and does not prove an
executable listing or completed sale. Reasons are calculated even when market
checks pause live signals, so missing history and weak patterns can be diagnosed
immediately.

The report includes outcome rates by dip depth and prior-day market trend. It
labels a sample under 50 resolved setups as still collecting evidence. This
scorecard does not automatically change live rules: BIN target observations are
not completed sales, and changing thresholds on a small or biased sample could
make calls less reliable.
Calls expire after 12 hours. `target_observed` requires two later fresh readings at
or above the target, at least ten minutes apart, before expiry. It is **not** a
completed sale or realised profit. Missing/stale data cannot prove trade failure;
`expired` means the target was not confirmed in the collected data.

With Discord posting disabled, only people with access to the service logs can
see the test. Calls are still based on observed BINs and are not completed sales
or guaranteed profit.

If a process is killed abruptly, `scanner.lock` may remain. Stop/verify that no
scanner is running, then remove that one lock file before restarting. Never delete
a live process's lock. Malformed state fails closed; preserve it for investigation.

## Verify

```bash
node --test scripts/flip-test.test.mjs
```

Tests cover eligibility boundaries, repeatable recoveries, outliers, stale and
duplicate observations, falling trends, broad crash pauses, deduplication, and
target expiry. Backfill tests execute its SQL against a test database and verify
first-run signals, preserved cooldowns, and missing/invalid data handling. Tests
use synthetic data and do not establish trading accuracy.
