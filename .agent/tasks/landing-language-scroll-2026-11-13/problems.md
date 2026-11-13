# Verification problems

## Browser builder pass 1 — AC2 pending

The fixture's first run asserted the menu's final anchor position while its real entrance animation was still running. The browser log records `AssertionError: menu anchored`. The old implementation's scroll lock and disappearing header were reproduced before this assertion.

Reproduction: run `node .agent/tasks/landing-language-scroll-2026-11-13/browser-check.cjs builder` without waiting for menu animations, then measure its rectangle immediately after it becomes visible. Expected: measure the final positioned menu after animation. Actual: a transient animated rectangle was measured. Affected file: task browser-check.cjs; production scope is unchanged.

Smallest correction: await the element's actual animation completion before measuring, retaining all geometry assertions and the negative control. Rerun the current source after correcting the measurement.

## Builder dependency consistency — AC5 pending

The initial dependency bootstrap copied the original working tree's package manifests, which were older than the clean origin/master checkout. Initial browser results and locale tests are exploratory evidence only. The typecheck using these dependencies was stopped; no success is attributed to it.

Expected: installed versions match the current clean checkout's package-lock.json. Actual: source was current but installed dependencies came from the older root checkout. Smallest correction: reinstall from the clean checkout's manifests, regenerate Prisma, and rerun all checks. The browser runner now asserts the exact installed versions against the current lockfile and records manifest hashes and versions. Production code remains unchanged.

## Upstream refresh — final verdict pending

After the builder passed, origin/master advanced from 4bfb5dcf to 1e47bdbd (registration guide). The fast-forward was applied during the first verifier's run, so that run is not used as the final current-code verdict. Expected: stable HEAD for the complete final pass. Actual: upstream code changed during an intermediate pass. Smallest correction: rerun all checks after the fast-forward, and record/assert HEAD and input hashes at the beginning and end. Only the language-switch production diff belongs to this task.

## Final resolution

All earlier measurement/environment/upstream issues are resolved. Fresh verifier-latest pass: every acceptance criterion PASS, all five commands exit 0, and HEAD/input hashes remain stable. No additional production changes were required.
