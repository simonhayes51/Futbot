# Player Evolution recommendations

- `/evolution evolution:…` explains the selected Evolution, entry restrictions, completion challenges and popular starting cards. `/evolutions` remains available as an alias.
- `/evo player:…` searches paths for the **exact card version** selected from autocomplete. Choose the correct rating and rarity.
- Optional `max_evos` is 1–3 (default 3). Optional `budget` limits Evolution coin fees, including zero for zero-coin-fee routes. Buying the starting card and token/reward unlocks are separate. `market` selects the starting-card price platform.

The price database's `source_player_id` identifies the player; `source_card_id` identifies the exact starting item. This reads existing columns and requires no migration or new environment variables.

The public FUT.GG player-path endpoint supplies the ordered steps and finished card. The captured HAR contains successful single-Evo requests. The implementation requests up to three Evos and validates whatever chains are actually returned; longer-chain availability still needs verification from the deployed bot because the development host received HTTP 403 on live requests. Authentication headers or HAR credentials are not replayed.

Results exclude mismatched starting items, expired steps, partial stages and paths whose availability or deadlines cannot be verified. It compares up to ten pages within a 25-second lookup budget, caches successful results for five minutes, and labels incomplete coverage. Cached paths are rechecked for expiry when served.

Ranking: final GG Rating (rated paths first), final OVR, lower coin fees, fewer stages. The command displays the top three and one additional lowest-coin alternative when different and without a listed extra unlock. Popularity is not used to rank player paths. Starting-card prices are optional and come from the existing market feed.

The result shows before/after stats, skills and weak foot, fees and unlock notes, earliest start deadline, and links to the exact finished paths. Branch choices must follow the linked path. It cannot know which unlocks, cards or Evolution progress a user already owns. API failures are shown as lookup failures with a source link, rather than being reported as no eligible paths.

Restart the Discord bot service (`npm start`) after deployment to register the new command schemas.
