# Step 5 (#193): appleboy/scp-action v0.1.7 → v1.0.0

Where used: `deploy.yml` "Upload tarball via SCP" + "(retry)" — only when the server could not pull the
tarball from GitHub itself (`if: steps.pull.outcome != 'success'`), so a normal deploy skips them;
`screenshots.yml` "SCP to prod" (manual workflow, disabled).

## Changes checked
- `action.yml` v0.1.7 vs v1.0.0: no input removed; added `capture_stdout`, `curl_insecure`, `protocol`,
  `version`; defaults of rm/overwrite/strip_components/debug/tar_dereference became empty instead of
  false/0. Runner: Docker image `ghcr.io/appleboy/drone-scp:1.6.14` → composite step that downloads the
  `drone-scp` 1.8.0 binary from GitHub releases — the same mechanism as `appleboy/ssh-action@v1`, which runs
  in every deploy.

## Local emulation (OpenSSH server on 127.0.0.1:2222, password login like the deploy)
Inputs exactly as in the workflows, every other input = that version's action.yml default ('' if none),
passed as INPUT_* to the binary the action runs (1.6.14 for v0.1.7, 1.8.0 for v1.0.0):

| Case | v0.1.7 (drone-scp 1.6.14) | v1.0.0 (drone-scp 1.8.0) |
|---|---|---|
| deploy fallback: source=deploy.tar (20 MB), target=APP_DIR, timeout=60s | ok, sha256 047c9a30 = source | ok, sha256 047c9a30 = source |
| screenshots: source=public/screenshots/*, strip_components=2, rm=false | desktop/home.png, mobile/home.png | identical tree and hashes |
| re-upload over an existing deploy.tar (retry case) | — | ok, replaced (16c6e082 = source) |
| wrong password | — | exit 1 (step fails → the deploy's retry/stop logic works as before) |

Failure mode on prod: if the fallback ever fails, the `upload` job fails before any SSH step on the server,
the `deploy` job does not run, and the site stays on its current build.
YAML valid; tests reading deploy.yml / scripts: 44/44.
