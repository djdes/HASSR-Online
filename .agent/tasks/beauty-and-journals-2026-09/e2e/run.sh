#!/usr/bin/env bash
# Полный прогон e2e на локальной базе wesetup_wt_mc (сервер next dev на :3034).
# 1) фикстуры → 2) сидер второй волны дважды → 3) браузерный сценарий → 4) срез базы.
set -u
cd "$(dirname "$0")/../../../.."
T=.agent/tasks/beauty-and-journals-2026-09
R=$T/raw
mkdir -p "$R" "$T/shots"
npx tsx $T/e2e/make-users.ts > "$R/make-users.log" 2>&1
npx tsx $T/e2e/seed-check.ts reset >> "$R/make-users.log" 2>&1
npx tsx prisma/seed-disable-new-journals-2026-09b.ts > "$R/seed-09b-run1.log" 2>&1
npx tsx prisma/seed-disable-new-journals-2026-09b.ts > "$R/seed-09b-run2.log" 2>&1
npx tsx $T/e2e/seed-check.ts show > "$R/seed-09b-db-after.json" 2>&1
export CHROME_EXE="${CHROME_EXE:-$LOCALAPPDATA/ms-playwright/chromium-1232/chrome-win64/chrome.exe}"
node $T/e2e/bj-e2e.mjs "$T/shots"
code=$?
npx tsx $T/e2e/db-check.ts > "$R/db-after-e2e.json" 2>&1
exit $code
