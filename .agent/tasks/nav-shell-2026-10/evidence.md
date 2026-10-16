# Evidence — nav-shell-2026-10 (новое меню кабинета)

Дата: 2026-10-16. Рабочая копия `D:\wt\nav-shell`, ветка `feat/nav-shell` от `origin/master` (`e79bc692`).
Коммиты реализации: `77145571` (меню), `e3890922` (доработки по ревью). Оба в `master`, задеплоены
(прод: `.build-sha` = `e38909222e14…`, pm2 `haccp-online` online, `/login` 200).

Стенд: `next dev --webpack -p 3025` (`NEXT_DIST_DIR=.next-e2e`), локальная база
`localhost:5432/wesetup_e2e` (создана заново, `prisma db push` + `prisma/seed.ts`), сиды
`.agent/tasks/nav-shell-2026-10/e2e/setup.ts` (организации стенда вкладок точек + заведующая и
«проверяющий» с линейной ролью). Прод не трогался: в `.env` рабочей копии только e2e-база.

## Проверки

| Команда | Результат |
|---|---|
| `npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` | exit 0 |
| `node --import tsx --test "src/**/*.test.ts"` | 3830 pass / 0 fail (после доработок по ревью) |
| pre-commit (typecheck + `npm run test:gate`) | ✓ (коммиты `77145571`, `e3890922`) |
| `node scripts/i18n-types.mjs --check` | OK |
| `npx eslint` по изменённым файлам | 0 ошибок (предупреждения — старые в `dashboard/page.tsx`, `announcement-banner.tsx`) |
| e2e-смоук `.agent/tasks/nav-shell-2026-10/e2e/smoke.ts` | S1–S6 PASS, см. ниже |

## E2E (Playwright, `localhost:3025` + `wesetup_e2e`)

| Сценарий | Шаги | Итог | Файл |
|---|---|---|---|
| S1 управляющая, 3 точки, 1280px, светлая/тёмная | S1.1–S1.24 | 25/25 PASS | `raw/smoke-s1-s4-full.log` |
| S2 одна точка / флаг выключен | S2.1–S2.2 | PASS | `raw/smoke-s1-s4-full.log` |
| S3 повар | S3.1–S3.2 | PASS | `raw/smoke-s1-s4-full.log` |
| S4 заведующая и verify-only | S4.1–S4.7 | PASS (перезапуск после исправления проверки S4.1) | `raw/smoke-s4-s5-rerun.log` |
| S5 телефон 390×844 | S5.1–S5.4 | PASS | `raw/smoke-s5-s6.log`, `raw/smoke-result-s5-s6.json` |
| S6 Mini App | S6.1–S6.2 | PASS | `raw/smoke-s5-s6.log`, `raw/smoke-result-s5-s6.json` |

S4.1 в первом полном прогоне упал на ожидании: заведующая с `/dashboard` уходит на `/control-board`
потоковым редиректом, а проверка ждала конечный адрес до него. Проверку переписали на ожидание
перехода, сам переход верный. Снимки всех сценариев — `raw/*.png` в рабочей копии `D:\wt
av-shell` (`.gitignore` не пускает `.agent/**/*.png` в репозиторий).

## Критерии приёмки

См. `evidence.json` — статус по AC1…AC13 и ссылки на проверки.

## Замечания стенда

- Два файла рабочей копии (`src/components/ui/select.tsx`, `src/lib/ppe-issuance-document.test.ts`)
  оказались испорчены на диске после медленного `git worktree add` (бинарный мусор при «чистом»
  индексе). Восстановлены из git; все остальные 3384 файла `src/ prisma/ scripts/ public/`
  сверены по хешу с индексом — совпадают.
- `/settings` перенаправляет потоком RSC (статус 200 + переход роутера), а не 307: страница
  рендерится внутри layout кабинета.
- Телефонный переход (S5.4) на dev-стенде висел минутами. Причина: стенд работает по HTTP/1.1,
  а пять превью журналов через `/_next/image` (dev-оптимизатор отвечает десятки секунд) вместе с
  потоком `/api/live` занимают все 6 соединений браузера к хосту, и переход ждёт в очереди. Прямой
  `goto` после загрузки превью проходит за 1,9 с. Прод работает по HTTP/2 (проверено `http2.connect`),
  превью там отдаётся за 0,04 с, поэтому к продукту это не относится. В смоуке на телефонных контекстах
  `/_next/image` отключён, после этого тап по пункту меню переходит сразу (`tapNavigated: true`).
