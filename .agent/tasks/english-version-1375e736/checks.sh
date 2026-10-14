#!/usr/bin/env bash
set -u
cd /var/www/wesetupru/data/recaptcha-release-20261013/repo
TASK=.agent/tasks/english-version-1375e736
PHASE="$1"
result=0
npm run typecheck > "$TASK/raw/$PHASE-typecheck.log" 2>&1 || result=1
printf 'typecheck finished\n'
npx tsx --test src/i18n/site-locale.test.ts src/i18n/public-copy.test.ts src/site-locale-proxy.test.ts src/page-navigation-proxy.test.ts src/lib/brand-qr.test.ts src/components/landing/qr-player/qr-player.test.ts > "$TASK/raw/$PHASE-focused.log" 2>&1 || result=1
printf 'focused tests finished\n'
node "$TASK/run-lint.cjs" > "$TASK/raw/$PHASE-lint.log" 2>&1 || result=1
printf 'lint finished\n'
npm run test:gate > "$TASK/raw/$PHASE-gate.log" 2>&1 || result=1
printf 'full gate finished\n'
printf '%s\n' "$result" > "$TASK/raw/$PHASE.exit"
