# Verification findings and repairs

## Resolved: exact scope of translated role labels (AC1/AC4)

The first baseline gate exposed three role-fallback tests. An initial string-token replacement also changed identical literal role labels elsewhere in the catalog. Restored catalogs from the clean task base and applied the requested edits by their complete message paths. Actual role labels and PDF fallback semantics are unchanged. A new current-source audit compares every changed leaf against the allowed message-path manifest. The gate rerun passes 275 tests across 66 files.

## Resolved: isolated checkout legacy fixture (AC4)

Sparse checkout excluded the existing three MP3 voice samples required by narrated-video.test.ts. Restored their original tracked bytes from HEAD at the expected test path. No voiceover, test assertion or production behavior was altered. The narrated-video test is included in the passing gate rerun.

## Resolved: standalone browser harness (AC3/AC4)

The browser fixture initially lacked the `process.env` replacement normally supplied by Next.js. Added the harness-only replacement. One expected Uzbek heading used singular rather than the current plural. Corrected the locator to the actual dictionary string. The resulting 18-check browser pass covered real staff/editor/QR components in all three languages and desktop/mobile sizes; the final pass adds the actual login page.

Visual inspection then identified that the fixture CSS scanner covered components but omitted classes in the login route. Expanded the scanner to all `src`, reran all 24 checks and inspected the corrected two-column desktop login. This was a fixture issue; production layout classes were unchanged.

After incorporating fresh master, sparse checkout again omitted the existing narrated-video fixtures. Restored the exact tracked files before the final gate rerun.

## Resolved: complete shared-auth coverage (AC2/AC3)

The final shared-surface review identified a food-production-only heading and food-regulation seals on the login/registration panels. Replaced the seals with existing Lucide industry symbols and localized medical/food service/manufacturing/retail labels; generalized the login heading and description. The general FAQ now describes electronic logs without extending a food-specific legal statement to other industries. The English social image uses the same neutral positioning.

The final inventory also found a kitchen-tablet example on the shared cloud feature page. Neutralized the three locale values and synchronized the duplicate source feature text after the parity check caught it. Reran locale checks and the gate on the resulting files.
