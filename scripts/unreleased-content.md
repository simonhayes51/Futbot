# Unreleased-only content watch

The monitor displays and delivers only content with a positive, current basis for
being unreleased. Newly captured menu details and changes to live SBC/EVO records
remain in storage for comparison but are excluded from the feed, report and Discord
outbox. Previously queued live-item events are also suppressed, without deleting
historical records or marking them as delivered.

Two positive signals are supported:

- A future EA release timestamp. The signal stops qualifying at that timestamp.
- Owner confirmation on a public catalogue entry, valid for 24 hours. A missing
  menu entry or newly seen catalogue string is not itself treated as proof.

The one setup exception is Twilight Screamer EVO Pack, catalogue ID 20304, which
the owner confirmed unreleased on 23 October 2026. That dated confirmation applies
only on that UTC date and only to that exact item, not to every Scream pack. Renew
it through the review controls if it is still unreleased afterwards. Its description
contains partial Batigol Precision requirements; upgrades, cost and release time
remain unknown. No eligible-player certification is inferred from partial clues.

The main page shows these findings with the original text, extracted requirements,
source and release-status basis. Use **Now released — remove** when it becomes
available. To confirm other public entries, expand **Review public-file entries**,
search for the entry and choose **Confirmed unreleased — show for 24 hours**.
Unknown and released catalogue entries never trigger Discord alerts. This review
view is separate from the unreleased feed; it does not claim those entries are new.
Review controls use the existing exact-owner session, origin and CSRF protection.
No additional secrets, variables, database migration or new service are required.

The public scanner now extracts ordinary pack descriptions as well as EVO packs
and EVO localisation strings. It polls the three already discovered public files
at the existing interval. It does not guess URLs or probe hidden IDs. When EA rotates
the content root, a fresh startup capture may be required to discover the new URLs.

After deployment, a currently qualified finding already present in a silent baseline
can enter the outbox once. Unchanged findings are not repeatedly queued. Every send
rechecks current status and current definition, so released/expired findings and
superseded details are suppressed. Empty eligible queues do not open a Discord DM.
User confirmation establishes reported availability as of the check, not an EA
release guarantee or proof of profitability. New entries without release evidence
require review; the software cannot independently establish their unreleased status.

Deploy the same change to the dashboard, leakscanner and (if retained) EA browser
worker so they share the content types and filtering. Keep the scanner's existing
watch command and shared APP_DATABASE_URL. No EA login or fresh HAR is needed to
recheck the public URLs already saved in the baseline.

## Public-file worker start command

```sh
npm run content:watch -- watch --deliver --interval 300
```

Do not add `--database` just to save content in PostgreSQL. `CONTENT_WATCH_STORE=database`
and `APP_DATABASE_URL` already select the application store. The CLI `--database`
flag requests player-price enrichment from `PRICE_DATABASE_URL`; it is unnecessary
for partial catalogue clues and can trigger a large lateral history query. Existing
commands containing the flag now skip that query unless a pending future EVO can
use a verified shortlist, or an explicit report was requested. The flag can simply
be removed for public-file discovery. Timeout logs identify which stage failed;
a timeout loading or saving application state is a separate issue from price reads.
