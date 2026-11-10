# Spec (frozen 2026-11-10): быстрый таргетированный прогон тестов (`test:changed`) локально и в CI + единые правила для агентов

Запрос владельца: «Изучи как работает CI CD проекта, нужно продумать и уменьшить время проведения тестов или как то сделать что какой то пуш проходит только малую часть тестов, а то каждый маленький фикс при пуше занимает целых 15 минут. Предложи оптимальное решение... да давай и пропиши агентам правила для этого что бы все агенты по одному правилу работали и знали об этом деплое».

## Исходное состояние (`origin/master` 8738309e)

- В `src/` 904 тестовых файла (`*.test.ts`, ~5 925 тестов). Полный прогон `npm run test:gate` запускает отдельный процесс `node --import tsx` на каждый файл и занимает **12–15 минут** локально.
- В `.husky/pre-push` полный прогон отключён, но в `AGENTS.md` и `scripts/verify-before-push.sh` (`npm run verify`) прописано обязательное выполнение полного `npm run test:gate` перед каждым пушем и слиянием в `master`.
- В `.github/workflows/deploy.yml` джоб `gate` на каждый пуш в `master` поднимает 5 параллельных раннеров (`typecheck`, `1/4..4/4`), каждый из которых делает чистый `npm ci` + `prisma generate` и гоняет все 904 тестовых файла.

## Критерии приёмки (AC)

- **AC1. Умный отбор тестов по графу импортов (`scripts/test-changed.mjs` + `src/lib/ci/test-changed.test.ts`):**
  - Определяет изменённые файлы по `git diff` (локально относительно `origin/master` + индекс/рабочее дерево или `HEAD~1..HEAD`; в CI — по диапазону коммитов пуша `GITHUB_EVENT_BEFORE..GITHUB_SHA` или `--range`).
  - Автоматически переключается в режим `full` при:
    - флаге `--full` / `TEST_FULL=1` или метке `[full-tests]` / `[all-tests]` в сообщении коммита;
    - изменении ядра/инфраструктуры (`package.json`, `package-lock.json`, `prisma/schema.prisma`, `tsconfig*.json`, `scripts/test-with-baseline.sh`, `tests/.legacy-failures.txt`, `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/auth-helpers.ts`, `src/lib/permissions.ts`, `src/lib/user-roles.ts`, `src/lib/journal-acl.ts`);
    - изменении более 25 файлов кода (`TEST_CHANGED_MAX_FILES`, по умолчанию `25`).
  - В режиме `changed` находит:
    - сами изменённые `*.test.ts`;
    - соседние тесты (`foo.ts` → `foo.test.ts`);
    - все `src/**/*.test.ts`, импортирующие изменённые модули напрямую или через 1 промежуточный модуль (до глубины 2 по графу импортов `@/` и относительных путей);
    - `src/i18n/*.test.ts` при изменении `src/i18n/**`.
  - Прогоняет отобранные тесты с проверкой по `tests/.legacy-failures.txt` (аналогично `test:gate`). Покрыт unit-тестами (`src/lib/ci/test-changed.test.ts`).

- **AC2. Быстрые локальные команды (`package.json`, `scripts/test-with-baseline.sh`, `scripts/verify-before-push.sh`):**
  - `npm run test:changed` запускает таргетированный прогон `node scripts/test-changed.mjs` (занимает секунды на обычном фиксе).
  - `npm run test:gate` (`scripts/test-with-baseline.sh`) по умолчанию использует `test-changed.mjs` (быстрый таргетированный гейт с авто-эскалацией до полного), а `npm run test:gate:full` (`TEST_FULL=1`) принудительно гоняет все 904 тестовых файла.
  - `npm run typecheck` использует инкрементальный кэш `--incremental --tsBuildInfoFile .tsbuildinfo-typecheck` для быстрого повторного прогона.
  - `npm run verify` (`scripts/verify-before-push.sh`) выполняет `npm run typecheck` + `npm run test:changed`.

- **AC3. Оптимизация `gate` в `.github/workflows/deploy.yml`:**
  - После `actions/checkout@v4` (`fetch-depth: 0` или до базового коммита пуша) определяется режим тестов через `node scripts/test-changed.mjs --ci-plan`.
  - На обычном пуше (`mode=changed` или `mode=none`):
    - Джоб `Type-check` после `npm ci` и `prisma generate` выполняет `npm run typecheck` и `npm run test:changed` (несколько секунд).
    - Шарды `1/4..4/4` пропускают `npm ci`, `prisma generate` и прогон тестов, завершаясь за ~10–15 секунд.
  - При `mode=full` (изменения ядра, `> 25` файлов, `[full-tests]` или `workflow_dispatch`) шарды `1/4..4/4` выполняют полный параллельный прогон всех тестов (`TEST_FULL=1`).

- **AC4. Единые правила для всех агентов (`AGENTS.md`, `.cursorrules`, `.codex/agents/*.toml`, `CLAUDE.md`):**
  - Во всех файлах правил репозитория и локального окружения зафиксирован единый регламент:
    - На обычных задачах и фиксах агенты используют `npm run typecheck` и `npm run test:changed` (или `npm run test:gate`, который теперь по умолчанию работает в режиме `changed` с авто-эскалацией) вместо 15-минутного полного прогона всех 904 файлов.
    - Принудительный полный прогон (`npm run test:gate:full`) нужен только при правках ядра/конфигурации или `> 25` затронутых файлов.
    - Описано актуальное поведение `deploy.yml` (параллельный старт `deploy` после `upload`, таргетированный `gate` на обычных пушах и авто-эскалация до 4 шардов).
