# First contact verification

- AC1. A root-only slot action renders a composer for the selected donor in the planner. The three locale dictionaries contain the same composer and status keys, with a regenerated message contract.
- AC2. The route binds the donor and campaign to the selected slot, and claims an atomic message fingerprint before the exact GoGetLinks send request. A mismatched or absent composer prevents submission. Delivery requires a new occurrence in conversation history. The client regression covers refused and mismatched composers, successful delivery, and deduplication after an ambiguous response.
- AC3. The send goes to the GoGetLinks conversation. Existing chat synchronization and message replies retain their normal paths. Conversations whose project GoGetLinks does not identify can be inspected with the account archive filter. Verification sent no live message to an unrelated donor.
- AC4. PASS. Fresh npm run typecheck exited 0. Fresh npm run test:gate passed 309 tests across 69 affected files. git diff --cached --check passed.
