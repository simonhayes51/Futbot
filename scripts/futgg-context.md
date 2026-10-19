# FUT.GG context companion for Futbot

Node 22+. Run from the **Futbot repository root**, in the same Node service
where `scripts/flip-test.mjs` is available. The script is independent of
bot startup and produces a JSON report. It does not register Discord
commands, send posts, create trade signals or modify the price database.

## What it gives Futbot

| Output | Use in Futbot |
| --- | --- |
| `watchCandidates` | A bounded review/watch list of cards explicitly listed as eligible for an open evolution, or appearing in its trending paths. Source reasons distinguish eligibility from popularity. |
| `gallery` | Captured cost, tokens and exact lineup for each Gallery grade; coins per token where cost and rewards are positive. Zero/missing costs require review, not a claim that the collection is free. |
| `playerContext[id].roles` | Returned role/chemistry combinations, scores and ranks. IDs are retained; no guessed role/style names. |
| `playerContext[id].communityTier` / `chemistryVotes` | Community preferences with vote counts, for player explanations. These are not predictions of profit. |
| `capturedMarketEvidence` | Historical BIN points, recent BIN changes, completed sales, price limits and overview fields found in the HAR. Original timestamps are preserved. They are not written into live prices or the flip test's history. |
| `evolutionPaths` | Captured evolution choices, costs and upgrades, with captured count/total/next to expose partial results. |
| `variants` | Captured holographic/pristine-to-standard mappings and public aggregate catalogue fields. Community usernames and personal club details are excluded. |

The existing bulk price worker remains the price source. An evolution
candidate is a reason to investigate a card, not evidence of a profitable
entry. Any trading decision still needs the existing fresh-price, history,
market-pause, tax and margin checks.

## Run with your captured HAR files

Put your `.har` files in one directory, then run:

```bash
node scripts/futgg-context.mjs --har /path/to/hars
```

Or select individual files:

```bash
node scripts/futgg-context.mjs --har /path/to/www.fut.gg2.har --har /path/to/www.fut.gg6.har
```

This mode needs no npm dependencies or credentials. It reads the response
bodies and exports selected public data; it does not replay captured
cookies, headers, signed URLs, requests, or account sessions. Later captures
of the same resource win regardless of filename order. Body-bearing 304 and
base64 HAR responses are supported.

Default output is `.futgg-context/27-ps5/context.json`. Context older than six
hours is retained for inspection but excluded from current evolution watch
candidates. Reports are labelled `har_replay`; exporting an old capture
never makes it fresh.

## Collect public live context

```bash
node scripts/futgg-context.mjs --live --card 50609974 --base-player 278326
```

`--card` is the exact EA **card** ID. `--base-player` is the underlying
player ID used by all-versions; these are different identifiers. Each
option may be repeated, up to ten IDs per run.

Live mode requests the manifest, its current all-evolutions version and the
Gallery hub. Each selected card adds role, tier and chemistry requests;
each base player adds an all-versions request. Requests are sequential,
with a 20-second timeout each. No polling loop runs automatically.
The version hash comes from the manifest and is not hardcoded.

This standalone mode uses ordinary public HTTP requests. Its live availability
has **not** been verified from your hosted service. A 403, timeout or other
request failure is reported in `errors` and produces exit code 1 while
retaining successful resources in the report. It does not circumvent the
failure or silently claim full coverage. If FUT.GG requires browser-based
transport, run collection through TradeHQ's working browser collector and
consume its exported context; this script's replay/reporting code is still
usable. Existing shared price collection is not replaced.

The live mode does not call signed price endpoints, private GG Club feeds,
or automatically request per-player evolution paths. Those fields appear
when the corresponding captured HAR response is provided. A mixed run can
use both `--har` and `--live`, preserving each source's own timestamp.

## Attach existing fresh prices to watch candidates

```bash
node scripts/futgg-context.mjs --live --with-prices --out /data/futgg-context/27-ps5/context.json
```

Reuses `PRICE_DATABASE_URL`, `GAME_YEAR` (27 by default), and `PLATFORM`
(`ps5` or `pc`). Futbot's existing `pg` dependency is loaded only for
`--with-prices`; install the repository dependencies with `npm ci` if needed.
For a local `.env`, use Node's `--env-file=.env` option before the script name.
Hosted services already supplying these variables do not need that option.

This reads a maximum of 200 candidates, in batches of 20 with an eight-second
SQL timeout and one connection set to read-only. It uses the existing
`futgg_players` catalogue and the appropriate console/PC BIN history table.
Only positive prices captured within 15 minutes are attached; cards explicitly
marked untradeable do not receive a price. Missing prices remain missing.
The source exposes capture times, which do not independently establish when
FUT.GG originally refreshed an unchanged quote.

Use a persistent output directory shared by a separate collector and the
bot if they run in different services. Writes replace the JSON atomically.
Generating a report does not make the running bot read it automatically.

## Integration with the private flip test

The module exports `contextForCard()`. Use it **after** the existing
`scan()` result has been calculated. For example, a separate integration
can annotate existing accepted results:

```javascript
import {readFile} from 'node:fs/promises';
import {contextForCard} from './futgg-context.mjs';

const context = JSON.parse(await readFile('/data/futgg-context/27-ps5/context.json', 'utf8'));
// result is the existing return value of scan(state, rows, now).
const annotated = {
  ...result,
  signals: result.signals.map(signal => ({
    ...signal,
    futggContext: contextForCard(context, signal.id, {
      year: 27,
      platform: 'ps5',
      now: Date.now(),
    }),
  })),
};
```

This snippet is an integration example, not a modification to
`flip-test.mjs`. The helper rejects other years/platforms, stale sources and
expired evolutions. Missing context returns null. It cannot unpause the
scanner, manufacture a signal or change an entry/target.

For Discord, the same output can support an evolution watch board, a
Gallery value board or additional player/compare details. These would need
handlers wired into `src/tools.ts` and scheduled feeds. Suggested command
names are **not** registered by this script. Use the bot's existing message
formatting/escaping and configured destinations when wiring them in.

## Verify

```bash
node --test scripts/futgg-context.test.mjs
```

Tests cover expiry, freshness, source provenance, different platforms,
per-grade Gallery selections, zero costs, partial evolution paths, public
field allowlisting, capture ordering and explicit HTTP failures. Captured
responses have also been replayed through the CLI. No production database
access or live delivery to Discord was tested.
