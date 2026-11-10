# Evidence: быстрый таргетированный прогон тестов (`test:changed`) и единые правила для агентов (2026-11-10)

Проверено на ветке `feat/fast-ci-tests` от свежего `origin/master` (`8738309e`).

| AC | Итог | Чем подтверждено |
|----|------|------------------|
| AC1 Умный отбор тестов по графу импортов | PASS | Реализован `scripts/test-changed.mjs` (без внешних зависимостей, работает в том числе в CI до `npm ci`) и покрыт 7 unit-тестами в `src/lib/ci/test-changed.test.ts` (`raw/test-changed.txt`, 7 pass, 0 fail за 1.0 сек). Проверено на реальных коммитах истории (`63c38eea..2244de4c` → 2 файла, 5.5 сек; `77946dc4..8738309e` → 6 файлов, 6.6 сек; `d17d8441..63c38eea` с изменением `package-lock.json` → автоматическая эскалация в `mode=full`). |
| AC2 Быстрые локальные команды | PASS | В `package.json` добавлены `test:changed`, `test:gate:full` и инкрементальный кэш `tsconfig.typecheck.tsbuildinfo` для `typecheck`. `scripts/test-with-baseline.sh` (`npm run test:gate`) и `scripts/verify-before-push.sh` (`npm run verify`) по умолчанию используют `scripts/test-changed.mjs`, а `scripts/test-related.sh` вызывает `node scripts/test-changed.mjs --staged`. |
| AC3 Оптимизация `gate` в `deploy.yml` | PASS | В `.github/workflows/deploy.yml` сразу после `actions/checkout@v4` (`fetch-depth: 10`) выполняется `node scripts/test-changed.mjs --ci-plan`. При `mode=changed` или `mode=none` шарды `1/4..4/4` пропускают `npm ci` и `prisma generate` (завершаются за ~10 сек), а затронутые тесты запускаются в джобе `Type-check`. Полные 4 шарда запускаются автоматически только при `mode=full`. |
| AC4 Единые правила для всех агентов | PASS | Правила синхронно прописаны в `AGENTS.md`, `.cursorrules`, `.codex/agents/task-builder.toml`, `.codex/agents/task-verifier.toml`, `.codex/agents/task-fixer.toml` и локальном `CLAUDE.md`. |
