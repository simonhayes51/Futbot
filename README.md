# FutBot

Ultimate Team Discord tools, an editorial marketing website and a live Discord-authenticated control room. FC27 / PS5 by default. Reads your existing PostgreSQL catalogue and observed player and consumable price history; it does not collect prices or connect to EA accounts.

## What is implemented

23 Discord commands: `/price`, `/alert`, `/myalerts`, `/removealert`, `/pausealert`, `/resumealert`, `/testdm`, `/tax`, `/fodder`, `/movers`, `/budget`, `/watch`, `/unwatch`, `/watchlist`, `/compare`, `/dashboard`, `/help`, `/editalert`, `/serverpro`, `/serverwatchlist`, `/flip`, `/consumable`, `/consumables`.

- Player artwork, current BIN, freshness, 24-hour/7-day hourly-median graphs, period median lows/highs and after-tax value. Buy/sell alert, watchlist and chart buttons.
- Fodder boards: cheapest fresh-priced card at each rating (83–91 by default), PNG rating ladder; an optional exact rating shows up to three alternatives.
- Consumables market: managers, manager leagues and chemistry styles for PC and console; category search, individual price checks, 24-hour movement, `/consumables` market boards with rise/fall rankings, a select-to-open detail menu, interactive seven-day charts, saved-price watchlists and private threshold DMs. Requires the TradeHQ misc-price feed and migration 103 in the shared price database.
- Movers: top ten risers/fallers against the median of at least three observations 24–25 hours ago. Missing baselines are excluded.
- Budget finder and two-card price comparison.
- `/flip` lets traders post a selected PS5/Xbox or PC market call with entry/target, trader-rated risk, card artwork, current price and chart; readers can save the same market to a watchlist or create a matching alert.
- Cross-device personal watchlists, private target alerts with DM outbox/retries, pause/resume/cancel, DM delivery test. Editable active/paused targets, exact-card artwork, saved vs current BIN, distance to target and timestamp; paginated Discord alert controls.
- Live dashboard at `/app/`: Discord OAuth, private member data, card explorer, downloadable charts, fodder cards/board download, consumables market, movers, watchlists, alerts, tax calculator and manual investment records with fresh-price after-tax valuations.
- Server manager workspace: server name/accent/footer, destination channel selection, live preview, manual fodder board publishing and activity log. Automatic fodder/movers/market-brief/shared-watchlist feeds, local posting schedules, scoped role mentions, previews, posting history and pause controls. Shared server lists and sponsored-seat management. Saved settings are used by new bot embeds; this does not rename the bot account or avatar.

The original browser-local prototype is preserved at `/demo/`. `/app/` now uses the backend API rather than demo data. Personal alerts, watchlists and investments never appear in server-admin views.

## Deploy on Railway or Coolify

Node.js 22+. Repository root `/`, branch `main`. Install `npm ci --include=dev`; build/check `npm run check`. `tsx` is a runtime dependency. Build/test stages need dev dependencies; a runtime stage can use `npm ci --omit=dev` after checks.

### Simplest option: one service for both bot and website

1. Deploy this repository as a Node/Nixpacks/Railpack application, not a static site.
2. Start command: `npm run migrate && npm start`.
3. Set `WEB_ENABLED=true`, all existing database/bot variables and the dashboard variables below.
4. Set Coolify’s exposed container port to match `PORT` (your existing deployment uses **80**; the code default is 3000), or use Railway's supplied `PORT`. Generate a public HTTPS domain pointing to that port. Health-check path `/healthz`.
5. Set `PUBLIC_URL` to that exact HTTPS origin, without a path, and redeploy.
6. In your Discord application's OAuth2 settings, add the exact redirect URL `https://YOUR-DOMAIN/auth/callback`.
7. Visit `https://YOUR-DOMAIN/app/` and continue with Discord. The same service also serves the marketing homepage.

Use one replica for the combined service. Do not also run a second bot instance with the same token.

### Separate bot and dashboard services

Use the same repository twice. Bot: `WEB_ENABLED=false`, start `npm run migrate && npm start`, no public domain or HTTP health check. Dashboard: start `npm run migrate && npm run start:web`, public port/domain, `/healthz` health check. Set the same database URLs and bot token on both. OAuth variables belong on the dashboard; also set `PUBLIC_URL` on the bot so `/dashboard` links correctly. Both services use the same application database. The dashboard process does not open a Discord Gateway connection or run the alert/feed workers.

Do not deploy `/app/` on static-only hosting: login, sessions and API routes require Node. The marketing pages and `/demo/` can be separately hosted as static files, but links must route to your live dashboard origin.

## Environment

Copy `.env.example` into hosting variables. Never commit real values.

```dotenv
PRICE_DATABASE_URL=postgresql://READ_ONLY_USER:.../existing_prices
APP_DATABASE_URL=postgresql://APP_USER:.../futbot
DISCORD_TOKEN=YOUR_BOT_TOKEN
DISCORD_GUILD_ID=YOUR_TEST_SERVER_ID
GAME_YEAR=27
PLATFORM=ps5
ALERT_POLL_MS=30000
MAX_PRICE_AGE_MINUTES=15
FREE_ALERT_LIMIT=3
WEB_ENABLED=true
PUBLIC_URL=https://YOUR-DOMAIN
DISCORD_CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
DISCORD_CLIENT_SECRET=YOUR_DISCORD_OAUTH_CLIENT_SECRET
SESSION_SECRET=GENERATE_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
PORT=3000
```

Generate a session secret with `openssl rand -hex 32`. Keep it stable across deployments. Rotating it invalidates existing encrypted session tokens; users must sign in again. Use the OAuth client secret, not the bot token, for `DISCORD_CLIENT_SECRET`.

An omitted `DISCORD_GUILD_ID` registers commands globally. If set, the bot must be a member of that server. Invite the bot with `bot` and `applications.commands` scopes. It needs View Channel, Send Messages, Embed Links and Attach Files for board publishing. No privileged Gateway intents are used. Website login requests `identify guilds` scopes only.

## Data and schema

Use separate price and application databases. `npm run migrate` applies the idempotent SQL files in `sql/` to the application database only. The price pool sets default transactions read-only. Website sessions, player/fodder/consumable alerts, delivery outbox, player and consumable watchlists, server settings, activity, investments, feed schedules/runs, shared lists, subscription state and seats live in the application database.

Price catalogue: `public.futgg_players`. Console observations: `public.futgg_bin_history`; PC observations: `public.futbot_pc_bin_history`. Manager, manager-league and chemistry-style observations are read from `public.futgg_misc_price_history`. The consumables page and `/consumable` command need the TradeHQ misc-feed change and migration 103 on the same price database; see [TradeHQ PR #392](https://github.com/simonhayes51/tradehq/pull/392). FutBot’s `npm run migrate` applies its own watchlist/alert tables to the application database. Preserve the game/platform filters in `src/prices.ts` and `src/market.ts`. FutBot stays read-only on the price database. To enable PC prices, apply TradeHQ’s `backend/migrations/101_futbot_pc_bin_history.sql` to the price database and run a second collector with `FUTGG_BULK_PLATFORM=pc`; see `auto_sync/FUTBOT_PC_PRICE_WORKER.md`.

Player market snapshots are shared and cached for five minutes per process, coalescing concurrent reads. Consumable prices are cached for 30 seconds. Player observations older than the configured freshness threshold (15 minutes by default) are withheld; consumables allow up to 30 minutes because the source worker stores unchanged prices on a staggered heartbeat. Price source queries time out after eight seconds. If market queries time out on a large database, check source indexes and query plans with the database owner: this app intentionally does not add indexes to your source database.

Price graphs use hourly medians, not every raw observation. Movement compares latest BIN with a baseline median, not trading advice. Fodder means cheapest available catalogue items at a rating: no guarantee of SBC eligibility, tradeability or an obtainable listing. Investment records are manual and unrealised; they do not sync with an EA club. Stale/unavailable holdings are excluded from profit totals.

## Access controls

OAuth state validation, encrypted server-side access tokens, random hashed session cookies (HttpOnly/SameSite/Secure over HTTPS), expiry and CSRF-protected writes. Server management checks Discord membership and Manage Server/Administrator permission at request time for writes (brief read caching), plus bot installation. Channel choices resolve bot channel permission overwrites. Server managers cannot inspect other users' targets, watchlists or portfolios. Manual publishing has a one-minute cooldown and an audit record. Scheduled feeds must be explicitly configured and enabled; one mentionable role is allowed per feed, with all other mentions disabled. No X/social ingestion is enabled.

## Development

`npm run check` and `npm test`. `npm run build:site` regenerates marketing pages (requires Python 3 locally); generated files are committed so deployments need not run Python. `dist/app/live.*` is the live dashboard. `dist/demo/` is the isolated prototype. Chart and fodder PNGs bundle DejaVu Sans with its licence, avoiding missing-font failures on cloud hosts.

Automated checks cover market grouping/cache/freshness, console-versus-PC price-table routing, chart generation, auth/permissions, CSRF rejection, private API queries, dashboard alert creation/branding, demo flows and marketing interactions. PostgreSQL-engine tests (PGlite) apply all application migrations and exercise real SQL for targets, limits, seats, feed runs, tenant isolation and billing reconciliation. Stripe signature tests use fixture events. Production source-database queries, real Discord OAuth/delivery, Stripe sandbox checkout and hosted browser layouts still require deployment verification with your credentials.

## Plans and billing

| Plan | Monthly GBP | Personal alerts | Private watchlist | Automatic feeds | Sponsored Pro seats |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | £0 | 3 | 20 | 0 | 0 |
| Personal Pro | £3.99 | 25 | 100 | 0 | 0 |
| Server Tools | £7.99 | Free allowance per member | Free allowance per member | 4 | 0 |
| Complete 25 | £19.99 | 25 per sponsored member | 100 per sponsored member | 8 | 25 |
| Complete 100 | £49.99 | 25 per sponsored member | 100 per sponsored member | 8 | 100 |
| Complete 250 | £99.99 | 25 per sponsored member | 100 per sponsored member | 8 | 250 |

Limits are enforced by the backend for both Discord and web additions. Existing records survive plan expiry; lower limits apply to new additions. Pro from an eligible claimed server seat applies across the account. Members must remain in the server and retain an eligible role. Choose roles in **Server setup**; no selected roles means any member can claim. Claims are explicit (`/serverpro` or Server watchlists), not automatically allocated to everyone. Individual Pro subscribers do not need a seat. Admins can release seats in **Member Pro seats**. Downgrades retain the oldest claims up to the new capacity; extra feed configurations are skipped until within the current allowance. Releasing a seat does not expose or delete personal records.

Checkout is disabled until both Stripe keys and the selected price ID exist. Use a **separate Stripe sandbox first**, with a restricted key stored in Coolify’s secrets/environment. Create one Product per plan, with monthly GBP recurring Prices at the amounts above. Set the five `STRIPE_PRICE_*` IDs, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on the **website service**. The bot needs no Stripe key: it reads the same application database.

Configure a Stripe webhook at `https://YOUR-DOMAIN/webhooks/stripe`, API version `2026-08-26.dahlia`, listening for:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `customer.subscription.created`, `.updated`, `.deleted`
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`

The endpoint checks the signature against the **raw body**, stores processed event IDs, and retrieves current subscription/invoice state under a lock to handle retries and out-of-order delivery. New subscriptions map through a stored Checkout Session. Success URLs never grant access. Unsupported prices revoke paid access; active subscriptions require a paid latest invoice (or a valid trial) and an unexpired period. Stripe prices are checked against advertised GBP amounts and monthly cadence before checkout. Customer Portal access is restricted to the purchaser, even when several admins manage a server.

Configure the Stripe Customer Portal for cancellations and payment-method updates. If enabling plan changes, use **separate portal configurations** for Personal Pro and server plans, set via `STRIPE_PORTAL_PERSONAL_CONFIG` and `STRIPE_PORTAL_SERVER_CONFIG`; leave plan switching disabled in a shared default portal. The app rejects incompatible plan scopes. Annual billing and automatic seat overages are not offered. Decide tax/VAT treatment before taking live payments; automatic tax is not enabled by this code. Enable Stripe Tax only after the relevant registrations are configured.

### Test server features before configuring payments

Optional operator beta access grants **Complete 25** to explicitly named servers until a fixed date. Set both variables on **bot and website**, then redeploy:

```dotenv
FUTBOT_BETA_GUILD_IDS=YOUR_TEST_SERVER_ID
FUTBOT_BETA_UNTIL=2026-11-15T23:59:59Z
```

This does not create a payment or subscription. Empty/expired values grant nothing. Remove it before testing a server’s subscription expiry. Use this only for your own test servers.

## Scheduled feeds and shared lists

The **Discord bot service** runs the scheduler every minute. The website saves schedules but never publishes automatically by itself. Keep one bot worker running. PG advisory locks and a unique feed/time-slot claim protect against duplicate worker execution.

1. Select an admin server workspace → **Server setup**. Save branding and member-role eligibility.
2. **Shared lists**: up to 10 named lists, 25 exact cards each. Members browse these under **Server watchlists** or `/serverwatchlist` and add cards to their own private watchlists/alerts.
3. **Automatic feeds**: choose fodder, movers, market brief or shared watchlist; destination channel; 1–6 daily times; IANA timezone (default Europe/London); optional mentionable role. Preview current data, then explicitly enable and save.
4. Give the bot View Channel, Send Messages and Embed Links; fodder images also require Attach Files. Channel overrides are checked again before each send.
5. Inspect **Posting history** for posted/skipped/failed/uncertain attempts. Feed cards expose a Discord card picker, which opens exact-card price, chart, watch and alert controls.

Fodder PNGs use the server’s author name, accent and footer. Other feed formats include current prices, card artwork and changes since the previous successful post. Price fingerprints prevent unchanged content from reposting just because a timestamp advanced. A full 83–91 ladder is required for fodder posts; stale or empty observations are never published as fresh. Delays over 15 minutes skip the missed slot instead of spamming backlog. Delivery timeouts are marked **uncertain**, not blindly retried. After an interrupted send, check Discord before publishing manually. Scheduler logs and run states remain visible; the next regular slot still runs.

Personal alerts/watchlists refresh every minute while open and visible, and stop refreshing while a target dialog/input is active. Latest card reads are coalesced/cached for 30 seconds; metadata/baselines/history for five minutes. Snapshot refresh windows align to five-minute boundaries with a one-minute buffer for normal collector batches, but the source has no confirmed batch-complete marker: freshness checks are used, not a claim of atomic full-market capture.

## Still outside this build

X/TweetShift-style ingestion (provider access/costs not configured), sales-history analytics, percentage-movement alerts, squad budget targets and automated trading. The separate `/demo/` remains illustrative and is not a subscription source of truth.

## Runtime diagnostics

The current startup log reports **21 commands**. A log reporting 6 or 17 commands is an older deployment. Redeploy the latest `main` revision. Database pools have finite connection/statement timeouts and idle error listeners. Alert failures report a redacted error code and actionable hint (including disk-full, connection resets, restarts and query timeouts), without printing connection strings. Receiving SIGTERM means the host asked the process to stop; check deployment/host events to establish why. Fontconfig discovery is bundled with the renderer.

Discord GET requests are coalesced and cached for ten seconds to avoid duplicate permission reads. Writes explicitly bypass cached permission/channel checks. Rate-limit responses respect Retry-After before one bounded retry; longer limits are shown with a wait time. Server discovery intersects the user guild list with the bot guild list rather than probing every user server. Market lists exclude incomplete/unknown metadata; movers show 80+ rated items priced at least 1,000 coins, using a median baseline with at least three observations. Large percentage changes are flagged for verification, not silently removed.
