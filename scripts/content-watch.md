# Private EA SBC / Evolution content monitor

This is an operator tool, separate from public Discord commands. It compares EA
definitions and EVO hints, records when this installation first observed a change,
and creates a private report. Optional Discord delivery sends only to the configured
user's DM. It does not buy players or publish server messages.

## Start with the HARs

```bash
npm ci
npm run content:watch -- import --har /path/to/first.har --baseline
npm run content:watch -- import --har /path/to/startup.har --baseline
npm run content:watch -- report
```

`--baseline` records existing content without alerting. The first import is always
silent. Subsequent imports without that flag create events for additions/changes.
Import captures in chronological order. Older observations cannot overwrite newer
records. Do not commit HARs, snapshots or the state directory.

The startup HAR discovers the exact public pack XML and English localisation URLs.
The public worker needs no EA login:

```bash
npm run content:watch -- poll
npm run content:watch -- watch --interval 300
```

Results are `.content-watch/report.md` and `.content-watch/state.json` by default.
Use `--state /data/content-watch` or `CONTENT_WATCH_STATE_DIR` on a persistent volume.
The state retains content records, source paths, event history and delivery status;
it never copies HAR request headers, cookies, auth responses, personal club items,
squads or balances. A public poll does not fetch authenticated UT endpoints.

Only the public English localisation and pack-description endpoints are allowed.
Redirects are rejected, requests time out, and responses have size/schema checks.
If a source fails, the scan leaves the previous baseline intact. It logs the failure
and retries on the next worker cycle. A startup asset-root change needs a new startup
HAR or explicit supported `--url` values; this version does not discover root rotations.

## Refresh SBC and full EVO definitions

The provided HARs demonstrate authenticated content requests. They do **not** prove
that EA exposes definitions before release. Do not label a served definition a leak
without comparing its availability independently. Public polls monitor catalogue
hints; logged-in definition snapshots must be refreshed separately.

1. Open the EA web app while logged in.
2. Paste the complete contents of `scripts/ea-content-collector.js` in DevTools Console.
3. Open SBCs or Evolutions once. The helper observes the next genuine content request.
4. Run `FutbotContentWatch.collect()`.
5. Import the downloaded `ea-content-snapshot.json`:

```bash
npm run content:watch -- import --snapshot /path/to/ea-content-snapshot.json
```

The collector requests only known SBC/EVO GET routes, sequentially, with a 250-request
cap. It follows all advertised evolution pages (`offset=0,20,...`) and reads each
advertised SBC set's challenges. It never submits squads, claims, buys or unlocks.
The session header stays inside the page closure, is used only with EA's observed
UT host, and is omitted from the downloaded content snapshot. Call
`FutbotContentWatch.stop()` afterwards or reload the page. If the app uses a different
transport and no session is observed, export a HAR with response content instead.

For continuous authenticated snapshots you would need a persistent signed-in browser
collector; this build deliberately does not transfer an EA session into the server.
The browser helper is supplied for manual collection, not silently scheduled here.

## Player matching and prices

Read exact-card metadata and recent prices from the bot's existing read-only source:

```bash
npm run content:watch -- report --database --platform ps5
npm run content:watch -- watch --database --platform ps5 --interval 300
```

This uses `PRICE_DATABASE_URL`, the existing console/PC history tables and an enforced
read-only database connection. Missing database columns are handled as missing data
using the row's JSON projection. The adapter accepts explicit `positions` or
`possible_positions` arrays (including secondaries), `base_playstyles_count`,
`plus_playstyles_count`, face-stat fields, and same-card `raw_data` where available.
A primary position alone is insufficient to verify position exclusions.

Alternatively pass `--players /private/enriched-players.json` with an array such as:

```json
[
  {
    "id": "123456",
    "name": "Example exact card",
    "gameYear": 27,
    "platform": "ps5",
    "rating": 80,
    "positions": ["ST", "RW"],
    "stats": {"PACE": 84},
    "basePlayStyles": 4,
    "plusPlayStyles": 0,
    "price": 700,
    "priceCheckedAt": "2026-10-23T07:19:00.000Z"
  }
]
```

Only entries for the selected game and platform are matched. Every decoded
requirement must pass to say `eligible`. Missing or unsupported constraints return
`unverified`; failed constraints return `ineligible`. Unknown fields never default to
zero. Expired/missing/invalid prices are hidden (15-minute default, adjustable with
`--max-age`). Rankings are verified eligibility first, then cheapest fresh price;
they are not a final-upgrade/meta-quality score or a predicted return.

Catalogue descriptions are partial clues and always remain unverified, including
Batigol Precision. SBC constraints are shown as squad requirements, never falsely
converted into individual-card eligibility. There is no squad solver or speculative
SBC demand model in this tool.

## Optional private alerts

Set `DISCORD_TOKEN` to your existing bot token and `CONTENT_WATCH_USER_ID` to your
Discord user ID in the service environment. Do not put either value in a command,
snapshot or Git. Delivery stays off unless explicitly enabled:

```bash
npm run content:watch -- watch --database --deliver --interval 300
# Or retry pending events once:
npm run content:watch -- deliver --database
```

Alerts include the evidence label, changed fields, requirements, and up to five
fully verified matches with fresh prices when available. New text in a catalogue
is labelled `release unconfirmed`. New API data says `advance availability unproven`
unless the definition has an explicit future release timestamp. Source paths and
observation times are included. Mentions are disabled.

The durable outbox saves changes before sending and marks success afterwards.
Failures remain queued. Discord nonces reduce duplicate sends on immediate retries;
a crash after sending but before saving can still duplicate a message on a later
restart. One process owns each state directory during a cycle. After a hard kill,
remove `writer.lock` only after confirming that the old process is no longer running.

## Validation

```bash
npm run check
node --import tsx --test src/content-watch.test.ts
npm test
```

Run this as a separate worker with `npm run content:watch -- watch --database
--deliver --interval 300` after importing its baseline on its persistent volume.
Starting the normal bot does not implicitly enable this worker. No messages are sent
during tests or HAR imports without `--deliver`.
