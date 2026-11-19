# GoGetLinks personal conversation verification

- AC1. The first-message route registers the campaign and donor pair after a submitted or previously claimed message and imports from the authenticated personal conversation.
- AC2. The sync fixture and parser regression cover a known invitation omitted from the common inbox, stable identifiers, direction, timestamp and campaign attribution. Opening or replying in that chat uses its verified personal conversation endpoint.
- AC3. The previous viarum.ru send is visible in authenticated GoGetLinks history from 16:24 Moscow time. The general index and the WeSetup message table were empty. Restored the verified message from its personal history and confirmed that the thread appears in the WeSetup-only list with one synced outbound message. No remote write was used.
- AC4. Fresh npm run typecheck and npm run test:gate passed (59 tests). Deployment and a repeat of manual sync on the fixed build are pending.
