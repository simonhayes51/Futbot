# FutBot · first build

A new standalone Ultimate Team Discord bot and private admin dashboard preview. The existing fut-trader-bot repository is not modified.

## What works in this build

- Responsive dashboard with eight pages: overview, card explorer, alerts, watchlist, market movers, feeds, appearance, and data connections.
- Local demo interactions: player filtering, selectable cards/chart ranges, hover chart values, watchlist, alert creation/pause/delete, feed configuration/pause/delete, appearance editor with Discord preview.
- Two actual card artworks (Lavia/Witzig) downloaded from the supplied catalogue. Other demo cards use clearly illustrative placeholders. All displayed prices, movement, stats for illustrative cards and history series are demonstration data.
- Separate TypeScript Discord service: `/price`, `/alert`, `/myalerts`, `/removealert`, `/tax`, `/testdm`; player autocomplete, card thumbnails, generated PNG charts, private target-price notifications.
- Database reader using SELECT-only PostgreSQL connection settings, restricted game year and a configured platform. Price lookups use the supplied source-card/time index.
- Application schema and alert worker with shared latest-price lookups per watched card, stale-data rejection, an outbox, delivery retries and a single-worker advisory lock. Deterministic Discord nonces reduce duplicate notifications after restarts; exactly-once delivery across database/Discord is not guaranteed.

## Run the Discord service

Use a continuously running Node 22+ service for the Discord gateway connection. This service is separate from the static preview hosting.

1. `npm ci`
2. Copy `.env.example` to `.env` and configure secrets in your host (do not commit them).
3. Use a SELECT-only database account for `PRICE_DATABASE_URL`.
4. Use a different application database for `APP_DATABASE_URL`.
5. `npm run migrate` applies **only** `sql/001-app.sql` to the application database.
6. Create a new Discord application named FutBot. Invite with the `bot` and `applications.commands` scopes and Send Messages, Embed Links and Attach Files permissions. No privileged message-content intent is required.
7. Configure `DISCORD_TOKEN` and optionally `DISCORD_GUILD_ID` for guild-scoped command registration during development. Without a guild ID, the service registers commands globally to its own application.
8. `npm start`

Default source selection is FC27 / `ps5`, the market observed in the supplied latest-data sample. Configure other platforms only after confirming actual database coverage. The max price age defaults to 15 minutes and is configurable.

## Source data contract

`public.futgg_players`: source_card_id, game_year, is_active, name/display_name/full_name, rating, primary_position, rarity, club and artwork URLs.

`public.futgg_bin_history`: source_card_id, game_year, platform, lowest_bin, captured_at, id. Current price means the latest positive observed BIN for that card/year/platform. A newly captured record does not by itself prove that the source market observation was newly updated. Charts use hourly median observed BIN values, up to seven days in this build.

The bot does not query old FC26 history or use recommendation snapshots to present profit guarantees. Sales analytics, broader market ranking and provider feeds are further modules.

## Dashboard status

The published preview is static and owner-private. It does **not** access production prices, sign into Discord, change your real server, send DMs or process payments. Demo settings live in localStorage in the current browser. Server switching and connections explain their pending setup rather than pretending to connect.

## Validation

- `npm run check`: TypeScript compile checks.
- `npm test`: alert threshold/freshness, tax, chart output and dashboard interaction tests.
- `node --check dist/app/app.js`: browser script syntax.

## Next implementation milestones

1. Configure source/app database credentials and the new Discord token; verify latest-price/card mapping using real FC27 cards.
2. Add Discord OAuth and a permission-checked admin API; move browser-local settings into the application database.
3. Wire admin alerts, brand settings and watchlists to the service, including role permissions and multi-server access checks.
4. Add feed ingestion, provider entitlements, filters and channel routing. The current feed page is configuration preview only.
5. Add sales/market analytics, server digests, portfolio and squad-shopping tools.
6. Add subscriptions after deciding the feature limits and payer model.

Production PostgreSQL/Discord integration tests and visual browser QA have not run without credentials and an available supported browser-control surface.

## Marketing website

The root website now includes a homepage, `/pricing/`, `/commands/` and `/servers/`. The original dashboard lives at `/app/` with its local demo interactions preserved. Generate the four marketing pages with `npm run build:site`. Shared styling and interaction code are `dist/site.css` and `dist/site.js`.

The website clearly identifies the development stage and proposed launch prices. No payments, installation, signup or production account connection is enabled. Server Complete pricing is proposed at £19.99/25 seats, £49.99/100 seats and £99.99/250 seats monthly. Annual pricing is ten monthly payments upfront (two months free). These are planning prices, not provisioned Stripe products. Free defaults are aligned to three alerts in the bot configuration.

The command guide documents the six implemented service commands and separately labels fifteen proposed commands. Pricing entitlements, server sponsorship, admin OAuth, social feed delivery, broader analytics and the member dashboard remain future work.

## Visual direction: FutBot Field Guide / Issue 001

The website takes its visual language from late-1990s football magazines and console demo-disc packaging: silver paper, cobalt blue, fluorescent orange, condensed italic sports headlines, numbered editorial rows and a player-card collage. The pricing page uses season-ticket styling; commands read as a game manual. The dashboard pairs dark console navigation with a silver workspace. All existing demo interactions and proposed pricing remain in place.

## Deployment and admin access

The website dashboard is `/app/` on the domain serving `dist`. This is a clearly labelled browser-local demo, not an authenticated live admin backend. Deploying the Discord worker alone does not serve a website or expose an admin URL. Live OAuth, role checks and the API connecting dashboard settings to the bot remain to be implemented.

Redeploy the bot with the existing `npm run migrate && npm start` command after updates. Charts bundle DejaVu Sans with its licence; no font installation is needed on Railway or Coolify. Run `/testdm` to verify real DM delivery. An actual threshold alert still requires a fresh observed price meeting its target.
