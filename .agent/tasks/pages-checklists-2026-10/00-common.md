# Общие условия для всех разделов S4 (страницы разделов по эскизам)

Заморожено 18.10.2026 сессией S4. Источники: `D:\handoff\wesetup-2026-10-18\prompts\S4-pages.md`,
`plan.md` раздел 4 (4.0–4.7) и раздел 7 (решения), `corrections-2026-10-18.md` («Кабинет»),
эскиз 79 (`C:\Users\Two\wesetup-backup-2026-10-17\scans-2026-10-18\Отсканированный документ 79.pdf`).

## Основа и окружение
- База — `integ/sketch-wave` на коммите, при котором у сведения на доске стоит «готово для страниц».
- Рабочая копия и ветка: `git -c safe.directory=* -C D:/www/Wesetup.ru worktree add D:/wt/pages-<раздел> -b feat/pages-<раздел> integ/sketch-wave`.
  Все команды git — с `-c safe.directory=*`, глобальный конфиг не менять.
- `node_modules` — жёсткими ссылками из `D:/wt/integ-sketch/node_modules`, затем
  `rm -rf node_modules/.prisma && npx prisma generate` (клиент Prisma — свой; `fsutil hardlink list` у файла клиента — 1 ссылка).
- База — своя копия `wesetup_pages_<раздел>` (`CREATE DATABASE … TEMPLATE wesetup_integ`, через node + `pg`), только `127.0.0.1:5432`. Порт 5433 (прод) — никогда.
- `.env` — копия из `D:/wt/integ-sketch/.env` со своей базой (`DATABASE_URL`, `DATABASE_URL_DIRECT`), `NEXTAUTH_URL`, портом и `NEXT_DIST_DIR=.next-pages-<раздел>`. Содержимое `.env` не печатать в логи и отчёты.
- Dev: `SWC_NATIVE_BINDING_CACHE=C:\swc-cache-two npx next dev --webpack -p <порт>`. Полный `next build` не запускать. Чужие процессы не трогать. В конце свой сервер остановить.
- Диск D: портит файлы: при странных ошибках — `node C:\Users\Two\wesetup-backup-2026-10-17\tools\verify-worktree.cjs <папка>`; перед коммитом `verify-worktree` → `corrupted: 0`, `scan-corrupt.cjs <папка>` → `corruptModifiedByAgent: 0`, `corruptUntracked: 0`.

## Как добавить пункт меню со страницей
1. Страница `src/app/(dashboard)/<путь>/page.tsx` с явным guard'ом (`hasFullWorkspaceAccess(`, `"admin.full"`, `sessionHasPermission(` или `hasJournalAccess(`).
2. Пункт — в нужный `*_MENU` в `src/lib/app-nav.ts`: `{ id, icon, href, access, match?, tabs?, hideIfVisible? }`; `access` повторяет guard страницы (тест сверяет текст). Новая подпись группы — в `NavMenuGroupLabel`.
3. Иконка lucide — в `src/components/layout/nav-icons.ts`.
4. Подписи `navigation.shell.menus.<раздел>.items.<id>` (и `groups`/`tabs`) на RU/EN/UZ (EN/UZ латиницей), затем `node scripts/i18n-types.mjs`.
5. `src/lib/app-nav.test.ts`: `menuShape(...)` и проверки по ролям. Карточку, ставшую пунктом, убрать из `SETTINGS_CARDS`.
6. Страница — `<SectionPageHeader description=… actions=… />` (заголовок по умолчанию — название пункта), блоки — нумерованные карточки 1-2-3 как на эскизах, `PageGuide` с подсказками.
7. Сайдбар, лист на телефоне, Mini App и ⌘K подхватят пункт сами. Динамические сегменты (`[id]`) в `href` модели запрещены; на `/settings` не ссылаться.
8. Только свои пункты: меню чужих разделов не трогать.

## Интерфейс
- Skill `design-system` перед правкой экранов: токены `#5566f6` / `#0b1024` / `#ececf4` / `#dcdfed`, `rounded-2xl|3xl`, без `text-muted-foreground`/`bg-card`, hover/focus 150–200 мс, `ring-[#5566f6]/15`.
- Подтверждения — `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`), не `window.confirm`. Выбор людей — групповой поповер в стиле `UserPicker`, не нативный `<select>`. Тосты — `sonner`.
- Пустые состояния — рецепт empty state с подсказкой, что сделать.
- Телефон 390 px — без горизонтальной прокрутки; кнопки шапки переносятся.
- Тексты интерфейса — через next-intl, RU/EN/UZ (EN/UZ латиницей); `npm run i18n:check` зелёный.
- «ХАССП» кириллицей. Без рекламы, цен, «попробуйте» в новых текстах (услуги «Пришла проверка» показывают существующие карточки каталога).

## Проверки раздела
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` — 0 ошибок.
- `npx eslint <изменённые файлы>` — без новых ошибок.
- `node --import tsx --test src/lib/app-nav.test.ts src/lib/settings-cards.test.ts src/lib/navigation-localization.test.ts src/lib/no-settings-hub-links.test.ts src/components/layout/navigation-localization.test.ts` + свои тесты — зелёные; `npm run i18n:check` — зелёный.
- Playwright на своём сервере: 1440×900 и 390×800 под руководителем (admin), заведующей (head_chef), поваром (cook) и в оболочке Mini App; скриншоты — `.agent/tasks/<id>/raw/` и копия в `C:\Users\Two\wesetup-backup-2026-10-17\pages-shots\<раздел>\`.
- Pre-commit hook (секреты, tsc, тесты против baseline) — без `--no-verify`. Тест «message argument types are generated…» на Windows лечится `node scripts/i18n-types.mjs`.

## Коммит и передача
- Коммит в `feat/pages-<раздел>`, без пуша; сообщение на русском, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Стейджить только свои пути: не `tsconfig.json`, не CRLF-шум `src/i18n/messages/confirm|errors/*.json`, `pricing-message-contract.d.ts`, не `.agent/tasks/english-version-*`.
- `src/lib/whats-new-notes.ts` не менять — текст «Что нового» предложить в `evidence.md` (собирает S3).
- `evidence.md` / `evidence.json` с вердиктом по каждому AC и путями к доказательствам.
