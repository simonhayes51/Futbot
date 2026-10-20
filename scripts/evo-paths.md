# Player Evolution recommendations

- `/evo info evolution:…` explains the selected Evolution, entry restrictions, completion challenges and popular starting cards. Legacy `/evolution` and `/evolutions` commands are removed when the bot registers commands.
- `/evo player player:…` searches paths for the **exact card version** selected from autocomplete. Choose the correct rating and rarity.
- Optional `max_evos` is 1–3 (default 3). Optional `budget` limits Evolution coin fees, including zero for zero-coin-fee routes. Buying the starting card and token/reward unlocks are separate. `market` selects the starting-card price platform.

The price database's `source_player_id` identifies the player; `source_card_id` identifies the exact starting item. This reads existing columns and requires no migration or new environment variables.

The public FUT.GG player-path endpoint supplies the ordered steps and finished card. The captured HAR contains successful single-Evo requests. The implementation requests up to three Evos and validates whatever chains are actually returned; longer-chain availability still needs verification from the deployed bot because the development host received HTTP 403 on live requests. Authentication headers or HAR credentials are not replayed.

Results exclude mismatched starting items, expired steps, partial stages and paths whose availability or deadlines cannot be verified. It compares up to ten pages within a 25-second lookup budget, caches successful results for five minutes, and labels incomplete coverage. Cached paths are rechecked for expiry when served.

Ranking: final GG Rating (rated paths first), final OVR, lower coin fees, fewer stages. The command displays the top three and one additional lowest-coin alternative when different and without a listed extra unlock. Popularity is not used to rank player paths. Starting-card prices are optional and come from the existing market feed.

Results show changed stats, upgrade notes, fees and unlocks, the entry deadline, and buttons for the exact finished routes. Unchanged stats and repeated ranking explanations are omitted. Incomplete searches are labelled and only claim to rank returned routes. Branch choices must follow the linked path. It cannot know which unlocks, cards or Evolution progress a user already owns. API failures are shown as lookup failures with a source link, rather than being reported as no eligible paths.

Restart the Discord bot service (`npm start`) after deployment to register the new command schemas.

## Gallery

`/gallery set:…` opens the complete cheapest supplied lineup for the highest available priced tier. Choose an optional `tier` or use the tier buttons to compare cheaper targets. Eight cards are shown per page; Previous/Next reach the full list. No text file is attached. Prices remain the exact item estimates from the Gallery feed; standard and holographic prices are never interchanged.

Gallery metadata first checks the verified exact-item supplement in `data/gallery-cards.json`. It contains 55 FC27 records checked against public FUT.GG item pages or the captured public holographic catalogue. Every record carries its exact year/item source URL and verification date. It stores no prices, owner data or club records. This includes the Holographic/Pristine variants from the reported LALIGA lineup. An exact-item rating from the live database takes priority over the supplement, so live-card rating upgrades are retained. Source links on verified player names open the exact version.

The public holographic catalogue is also read across later pages (up to 25, four concurrent requests, ten-second total budget). A pagination parameter is accepted only if the response confirms the requested page; ignored parameters cannot fabricate coverage. The five-minute cache retains card definitions only. Synced cards can receive a missing finish label from this catalogue, including the full “Pristine Holographic” label.

For missing items outside the supplement, public exact-version metadata is tried before the name-only base-player fallback. Only a current-year record with the exact item ID can supply rating or finish; a base-player match supplies a name only. A failed lookup affects that card's details, not the shopping list. A requested tier without a supplied solution falls back to the highest available tier with a short explanation. Tier and page controls have distinct Discord custom IDs.

Gallery controls belong to the requesting user and expire after 20 minutes or a bot restart. Other users can run their own command. Up to 200 active lists and 500 missing-card metadata lookups are cached.
