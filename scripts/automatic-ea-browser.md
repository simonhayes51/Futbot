# Automatic SBC / EVO collection with iPhone connection controls

This is a separate browser service. The existing `leakscanner` continues public-file
checks and private Discord delivery; the browser service supplies authenticated SBC
and EVO definitions to their shared application database. No HAR is needed after
connecting successfully. This implementation has not been validated against a live
EA login on Railway. Complete that pilot before relying on scheduled collection.

## Railway setup

Keep your existing Futbot dashboard and leakscanner services. Add one service from
the same `simonhayes51/Futbot` repository, named `ea-browser` for clarity.

| Setting | Value |
| --- | --- |
| Root Directory | `/` (repository root) |
| Branch | `main` after merging this change |
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.ea-browser` |
| Start command | `/bin/sh -c 'npm run migrate && exec npm run content:browser'` |
| Volume mount | `/data` |
| Public domain | None — use the existing dashboard |
| HTTP healthcheck | None — this is a worker |
| Replicas | 1 |

The custom Dockerfile installs Chromium and its Linux dependencies. Do not select
`/data` as Root Directory. Use that path only as the volume mount. Keep the custom
Dockerfile variable on this browser service; other services can continue Railpack.

Set these variables on the new browser service:

```env
APP_DATABASE_URL=<same existing app database as dashboard and leakscanner>
SESSION_SECRET=<exact same value as your existing dashboard>
CONTENT_WATCH_USER_ID=<same Discord user ID as dashboard and leakscanner>
GAME_YEAR=27
EA_BROWSER_PROFILE_DIR=/data/ea-browser
EA_BROWSER_INTERVAL_SECONDS=900
RAILWAY_DOCKERFILE_PATH=Dockerfile.ea-browser
RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30
```

Copy existing secrets through Railway variables, never into Git or chat. The browser
service does not need your Discord bot token or price database URL. The existing
scanner still needs its normal variables and `CONTENT_WATCH_STORE=database`.
Redeploy the existing dashboard with migrations so its owner-only connection page
and new tables are available.

## First live login test (from your iPhone)

1. Open your existing Futbot dashboard in Safari and sign in with your configured
   Discord account.
2. Open **SBC & EVO monitor**. Under **Automatic EA connection**, the worker should
   show online.
3. Tap **Connect EA**. This opens a view of Chromium running on Railway, not an EA
   iframe or your iPhone's own EA session.
4. Tap the EA login controls in the image. Tap a field, enter text in the box below,
   then press **Type text**. Use Tab, Enter, Select all, Delete and Scroll as needed.
   **Zoom screen** displays the image at full size for more precise taps.
5. Use your EA email/password login and complete verification yourself. Third-party
   console-provider sign-in pages outside EA's domains are not supported by this
   pilot. Verification is never bypassed or auto-solved.
6. Once inside the web app, press **Start / check now**. The connection view closes
   and a complete content scan starts. Check the status and last authenticated scan
   timestamp. It must show a successful check, not just a connected browser.
7. Leave it for at least two scheduled cycles. Confirm that the authenticated scan
   timestamp advances and the expected EVO coverage is complete before relying on it.

The first content scan establishes a silent baseline if none exists. Existing
baselines are compared normally. Changes appear in the existing dashboard/report;
the leakscanner delivers queued alerts on its next normal cycle. A completed
browser command is not itself proof of a successful scan — check the scan status.

## Day-to-day operation

The browser checks every 15 minutes by default. During the pilot, leave that default.
The minimum supported setting is 300 seconds; a shorter interval is not a guarantee
of earlier data or successful EA access. No scans run while the interactive view
is open, avoiding unexpected movement while you enter login details. Press Start
after login to close the view and enable scheduled checks.

The browser profile persists on `/data`. On restart it can reuse login cookies and
local state, then obtains a fresh UT session through the normal web-app load. On an
expired UT session it tries one normal reload. If EA requires a new login, verification
or blocks access, collection pauses and shows **Reconnect needed**. Rate limits also
pause collection. The worker honors EA's Retry-After header (seconds or HTTP date),
with a minimum one-minute wait; if none is supplied it uses a conservative 30-minute
fallback, not a known EA reset window. The cooldown persists across restarts and
blocks Start / check now until it expires. Checks stay paused afterwards until you
restart them manually. Content requests are spaced at least 1.5 seconds apart and
each scan is bounded to 180 seconds; the first request can still be rate limited
and this does not guarantee acceptance by EA. No fixed login lifetime is promised.

**Pause checks** stops scheduled reads without forgetting the browser profile.
**Close view** hides the private screen without deleting login data. **Disconnect &
forget login** stops checks, closes the browser and removes its saved profile. A new
login will then be required. The public scanner continues independently.

## Privacy and boundaries

- Only the exact configured Discord owner can view/control the browser. Mutations
  require the existing same-origin check and CSRF protection.
- The browser has no exposed remote-debugging port, public domain or separate login
  endpoint. Short-lived control commands pass through the app database encrypted
  with `SESSION_SECRET`, and command payloads are cleared after execution/expiry.
- Temporary browser images are encrypted in the database, only available while the
  connection view is active, and cleared when it closes. They may display private
  account information; keep dashboard access and the shared key private.
- The on-volume browser profile contains authentication cookies/state. It is private
  runtime data, excluded from Git and Docker build context. Do not share or upload it.
- The automatic collector only calls advertised SBC/EVO GET routes. UT trade,
  purchase, claim, squad-update and SBC-submit writes are blocked in the interactive
  browser too. Login and read-style club/appstats requests remain allowed.
- Captures, cookies, session headers, passwords, full request URLs and page screenshots
  are not included in content records, Discord alerts or application logs.
- New data is labelled as observed content; this cannot make EA expose unreleased
  definitions. Early availability is still unproven.

## Validation and known limits

Tests exercise paging, request allowlists, expired sessions, rate limits, incomplete
responses, encrypted commands/frames, owner/CSRF restrictions and the phone panel.
The full project TypeScript/test checks are required. Live Chromium download and
EA authentication could not be completed in the build workspace; the initial browser
download returned an unusable archive. Docker build, EA login, mobile interaction,
cookie persistence across a real redeploy and repeat reads must be verified on Railway.

If Railway cannot install Chromium, check its Docker build output and whether the
Playwright browser download hosts are reachable. If EA rejects the browser or shows
verification that cannot be completed, pause the pilot. This implementation does
not include stealth plugins, CAPTCHA bypass, automated password recovery or an
unattended credential-login script.
