#!/usr/bin/env bash
# База копии сайта для проверки приложения в CI: схема, шаблоны журналов,
# «Кафе «Демо»» с историей за 14 дней, задачи на сегодня, одноразовый повар.
# DATABASE_URL — только e2e-база localhost:5432/wesetup_e2e (скрипты сида это проверяют).
set -euo pipefail
OUT_IDS="${1:-ci-ids.json}"
T=.agent/tasks
echo "== prisma db push"
npx prisma db push --accept-data-loss 2>&1 | tail -5
echo "== prisma/seed.ts (шаблоны журналов)"
npx tsx prisma/seed.ts 2>&1 | tail -5
for s in seed-job-positions seed-journal-fill-modes seed-production-calendar; do
  echo "== prisma/$s.ts"
  npx tsx "prisma/$s.ts" 2>&1 | tail -3 || echo "[warn] $s failed"
done
echo "== shots-seed.ts"
SHOTS_SEED_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npx tsx $T/mobile-apps-2026-09/e2e/shots-seed.ts 2>&1 | tail -30
echo "== shots-claims.ts"
npx tsx $T/mobile-apps-2026-09/e2e/shots-claims.ts 2>&1 | tail -15 || echo "[warn] shots-claims failed"
echo "== ci-extra.ts"
npx tsx $T/mobile-e2e-ios-2026-09/ci-extra.ts "$OUT_IDS" 2>&1 | tail -40
