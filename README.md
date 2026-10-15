# FutBot

Ultimate Team Discord tools, an editorial marketing website and a live Discord-authenticated control room. FC27 / PS5 by default. Reads your existing PostgreSQL catalogue and BIN history; it does not collect prices or connect to EA accounts.

## What is implemented

17 Discord commands: `/price`, `/alert`, `/myalerts`, `/removealert`, `/pausealert`, `/resumealert`, `/testdm`, `/tax`, `/fodder`, `/movers`, `/budget`, `/watch`, `/unwatch`, `/watchlist`, `/compare`, `/dashboard`, `/help`.

- Player artwork, current BIN, freshness, 24-hour/7-day hourly-median graphs, period median lows/highs and after-tax value. Buy/sell alert, watchlist and chart buttons.
- Fodder boards: cheapest three fresh-priced cards at each rating (83–91 by default), PNG rating ladder, optional exact rating.
- Movers: top ten risers/fallers against the last observation 24–25 hours ago. Missing baselines are excluded.
- Budget finder and two-card price comparison.
- Cross-device personal watchlists, private target alerts with DM outbox/retries, pause/resume/cancel, DM delivery test.
- Live dashboard at `/app/`: Discord OAuth, private member data, card explorer, downloadable charts, fodder cards/board download, movers, watchlists, alerts, tax calculator and manual investment records with fresh-price after-tax valuations.
- Server manager workspace: server name/accent/footer, destination channel selection, live preview, manual fodder board publishing and activity log. Saved settings are used by new bot embeds; this does not rename the bot account or avatar.

The original browser-local prototype is preserved at `/demo/`. `/app/` now uses the backend API rather than demo data. Personal alerts, watchlists and investments never appear in server-admin views.

## Deploy on Railway or Coolify

Node.js 22+. Repository root `/`, branch `main`. Install `npm ci --include=dev`; build/check `npm run check`. `tsx` is currently a development dependency required at runtime, so keep `--include=dev`.

### Simplest option: one service for both bot and website

1. Deploy this repository as a Node/Nixpacks/Railpack application, not a static site.
2. Start command: `npm run migrate && npm start`.
3. Set `WEB_ENABLED=true`, all existing database/bot variables and the dashboard variables below.
4. Set container port 3000 on Coolify, or use Railway's supplied `PORT`. Generate a public HTTPS domain pointing to that port. Health-check path `/healthz`.
5. Set `PUBLIC_URL` to that exact HTTPS origin, without a path, and redeploy.
6. In your Discord application's OAuth2 settings, add the exact redirect URL `https://YOUR-DOMAIN/auth/callback`.
7. Visit `https://YOUR-DOMAIN/app/` and continue with Discord. The same service also serves the marketing homepage.

Use one replica for the combined service. Do not also run a second bot instance with the same token.

### Separate bot and dashboard services

Use the same repository twice. Bot: `WEB_ENABLED=false`, start `npm run migrate && npm start`, no public domain or HTTP health check. Dashboard: start `npm run migrate && npm run start:web`, public port/domain, `/healthz` health check. Set the same database URLs and bot token on both. OAuth variables belong on the dashboard; also set `PUBLIC_URL` on the bot so `/dashboard` links correctly. Both services use the same application database. The dashboard process does not open a Discord Gateway connection or run the alert worker.

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

Use separate price and application databases. `npm run migrate` applies the idempotent SQL files in `sql/` to the application database only. The price pool sets default transactions read-only. Website sessions, alerts, delivery outbox, watchlists, server settings, activity and investments live in the application database.

Price source: `public.futgg_players` and `public.futgg_bin_history`. Preserve field names and game/platform filters in `src/prices.ts` and `src/market.ts`. No DDL or writes run on the pricing database. The pricing collector continues independently.

Market snapshots are shared and cached for five minutes per process, coalescing concurrent reads. Expired observations are withheld even within the cache. They require fresh observations (15 minutes by default). Price source queries time out after eight seconds. If market queries time out on a large database, check source indexes and query plans with the database owner: this app intentionally does not add indexes to your source database.

Price graphs use hourly medians, not every raw observation. Movement compares latest BIN with a baseline observation, not trading advice. Fodder means cheapest available catalogue items at a rating: no guarantee of SBC eligibility, tradeability or an obtainable listing. Investment records are manual and unrealised; they do not sync with an EA club. Stale/unavailable holdings are excluded from profit totals.

## Access controls

OAuth state validation, encrypted server-side access tokens, random hashed session cookies (HttpOnly/SameSite/Secure over HTTPS), expiry and CSRF-protected writes. Server management checks Discord membership and Manage Server/Administrator permission at request time, plus bot installation. Channel choices resolve bot channel permission overwrites. Server managers cannot inspect other users' targets, watchlists or portfolios. Publishing is a deliberate button action with a one-minute cooldown and an audit record. No automatic external feed posting is enabled.

## Development

`npm run check` and `npm test`. `npm run build:site` regenerates marketing pages (requires Python 3 locally); generated files are committed so deployments need not run Python. `dist/app/live.*` is the live dashboard. `dist/demo/` is the isolated prototype. Chart and fodder PNGs bundle DejaVu Sans with its licence, avoiding missing-font failures on cloud hosts.

Automated checks cover market grouping/cache/freshness, chart generation, auth/permissions, CSRF rejection, private API queries, dashboard alert creation/branding, demo flows and marketing interactions. Real PostgreSQL queries, real Discord OAuth and hosted browser layouts still require deployment verification with your credentials.

## Still outside this build

Payments, sponsored Pro seats, entitlement enforcement, X/TweetShift-style ingestion, recurring digest scheduling, sales-history analytics, percentage-movement alerts, squad budget targets and automated trading are not implemented. The pricing page is proposed launch pricing, not an active checkout. Development watchlist allowance is 100; subscription tiers are not enforced. The command guide labels remaining ideas as roadmap.

## Runtime diagnostics

The current startup log reports 17 commands. A log reporting 6 commands is an older deployment. Redeploy the latest `main` revision. Database pools have finite connection/statement timeouts and idle error listeners. Alert failures report a redacted error code and actionable hint (including disk-full, connection resets, restarts and query timeouts), without printing connection strings. Receiving SIGTERM means the host asked the process to stop; check deployment/host events to establish why. Fontconfig discovery is bundled with the renderer.
