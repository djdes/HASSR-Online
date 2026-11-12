# Evidence: свежие данные сразу после смены организации/точки и единый тост смены

Ветка `claude/nice-curie-p6hwyq`, база — master `e28d552b`. Проверка 2026-11-12: локальная база PostgreSQL 16
(`prisma db push` + `prisma/seed.ts`), фикстура `raw/browser-check-script.cjs` — владелец аккаунта с
«ООО «Альфа»» (баланс 10 000 ₽, журналы по точкам, торговые точки «Кафе на Ленина» и «Кафе на Мира») и
«ООО «Бета»» (0 ₽); `next dev`, Chromium (Playwright): компьютер 1440×900 и iPhone 13, светлая и тёмная темы.

## Корень проблемы

1. `BalanceClient` и сотни других клиентских компонентов страниц копируют серверные данные в `useState`
   один раз. Смена — `router.refresh()` без перемонтирования (`SectionFrame` держал страницу смонтированной) —
   поэтому на экране оставались данные прежней организации до перезагрузки.
2. `SessionProvider` next-auth 4.24.15 читает пропс `session` только в инициализаторе `useState`
   (`node_modules/next-auth/react/index.js`): `useSession()` после смены отдавал прежние организацию/роль.
3. Оболочка (AI-помощник, окно тарифа, логотип, баннеры, отмена правок) жила между сменами со своим состоянием.

## Что сделано

- `src/lib/cabinet-scope.ts` — ключи области данных: `organization` (человек + организация) и `data` (+ точка
  и режим «Вся организация» при журналах по точкам).
- `src/components/layout/scope-boundary.tsx` — граница с `key` на клиенте. Кабинет: `ContentTransitionProvider`
  поднят над границей организации (шапка, меню, баннеры, виджеты — внутри), `SectionFrame` ключует страницу по
  области данных. То же в оболочке мини-приложения кабинета и в `/mini/*` (общий переход + граница области;
  AI-помощник приложения — по организации).
- `src/components/layout/server-session-sync.tsx` + `src/lib/client-session-sync.ts` — `useSession()` догоняет
  сессию из layout событием `storage` (тот же приём, что `adoptCookieSession`), без «загрузки» и без записи в
  токен; подключено в `AuthSessionProvider` (кабинет, `/root`) и `MiniSessionProvider`.
- `src/components/layout/switch-toast.tsx` — единый тост смены (`SwitchToastCard`, `showSwitchToast`) и одна
  логика `switchWithReturn` (смена → тост после прихода страницы → «Вернуться …» — та же смена обратно, её тост
  снова с возвратом). Заменил `point-switch-toast.tsx`.
- Переведены на него: смена организации (меню профиля, лист профиля, пилюля), точка (шапка, лист), автосмена
  по разделу, «Перейти на точку объекта» (`PointMismatch.selectedId` для возврата), «Выбрать всю организацию»
  (`pointId` со страниц), демо (вход — один тост вместо двух, выход — с возвратом в демо), новая организация
  (возврат в прежнюю), мини-приложение (организация и точка). Запрос смены организации — один
  (`postActiveOrganization` в `lib/switch-organization.ts`).
- Переводы ru/en/uz: `navigation.shell.switchToast.{close,organization,returnToOrganization}`; удалены ставшие
  ненужными `navigation.shell.point.close`, `layoutUi.organizationSwitcher.switched`,
  `notificationSettings.miniSwitchers.{organizationSwitched,locationSwitched}`,
  `organizationsUi.demoOrgBanner.welcomeDescription`, `layoutUi.createDemoDialog.ready`,
  `dashboardUi.completeProfileNudge.demoReady`; `message-contract.d.ts` перегенерирован.
- Отдельно: `src/lib/route-titles.ts` — две русские подписи-запаски («Торговые точки и помещения», «Настройка
  торговых точек») не догнали переименование из #218; из-за этого на master падал
  `src/lib/navigation-localization.test.ts` (проверено на чистом master).

## Критерии

| AC | Статус | Доказательства |
|----|--------|----------------|
| AC1 | PASS | `src/lib/cabinet-scope.test.ts`; `raw/browser-check.txt`: «Альфа» 10 000 ₽ → смена на «Бета» → `0 ₽` без перезагрузки (`full page reload happened: false`), узел баланса прежней страницы отсоединён (`old balance node still mounted: false`); «Вернуться» → снова `10 000 ₽` — компьютер и телефон, светлая и тёмная темы. |
| AC2 | PASS | `raw/browser-check.txt`: после смены организации узел шапки новый (`old header node still mounted: false`); после смены точки шапка та же (`header node kept ...: true`), страница новая (`page node replaced ...: true`); тост после смены есть (провайдер перехода и `<Toaster>` выше границы). Разметка: `src/app/(dashboard)/layout.tsx`, `src/app/mini/layout.tsx`, `mini-app-shell.tsx`. |
| AC3 | PASS | `src/lib/client-session-sync.test.ts` (перечитывать только при новой сессии с сервера и отставшем клиенте); `raw/browser-check.txt`: после смены `GET /api/auth/session`, затем `/api/settings/journal-controls` (провайдер настроек журналов перечитал их для новой организации). |
| AC4 | PASS | `src/components/layout/switch-toast.test.ts` (SSR-разметка ru/en/uz: крестик с подписью, кольцо `--toast-life:3000ms`, пилюля возврата с `truncate`, без возврата — без кнопки); `raw/browser-check.txt`: крестик в 9 px от правого и верхнего края, «Закрыть», пилюля 225×32 px, тост исчез сам через 3,8–3,9 с (3 с жизни + анимация ухода и опрос проверки). Скриншоты (не в репозитории): компьютер/телефон, светлая/тёмная. |
| AC5 | PASS | `switch-toast.test.ts` (порядок: запрос → тост с «Вернуться в «А»» → нажатие → обратный запрос → тост с «Вернуться в «Б»»; неудачная смена — без тоста); `raw/switch-call-sites.txt` — все места смены через `switchWithReturn`/`showSwitchToast`, старых тостов смены нет; `raw/browser-check.txt` — «Организация: ООО «Бета»» + «Вернуться в «ООО «Альфа»»» → нажатие → «Организация: ООО «Альфа»» + «Вернуться в «ООО «Бета»»», баланс 10 000 ₽; точка — «Торговая точка: Кафе на Ленина» + «Вернуться на «Вся организация»». Без возврата намеренно: страница точки (сама держит свою точку) и восстановление точки кнопкой «назад» браузера (вперёд ведёт «вперёд» браузера). |
| AC6 | PASS | `git diff` словарей (по 5 добавленных/7 удалённых строк в каждом языке), `npm run i18n:types`; `raw/switch-call-sites.txt` — удалённые ключи нигде не используются; i18n-тесты в полном прогоне зелёные. |
| AC7 | см. ниже | `raw/typecheck.txt`, `raw/typecheck-master-baseline.txt`, `raw/test-gate.txt`, `raw/eslint.txt`, `raw/next-build.txt`. |

## AC7 и ошибка типов на master

`npm run typecheck` даёт одну ошибку — `src/app/api/root/gogetlinks/plans/route.ts(109,42)`; та же единственная
ошибка на чистом master (`raw/typecheck-master-baseline.txt`). Её внёс коммит b9b1f2df9 (SEO, другой разработчик):
`prepareUpcomingPlannedSlots({ windowDays: 35 })` при сигнатуре `(now: Date, horizonDays)`. Из-за неё шаг
Type-check на master красный в последних запусках (деплой при этом проходит). Изменение этой задачи новых ошибок
не добавляет. Исправление (`prepareUpcomingPlannedSlots(new Date(), 35)`) меняет поведение SEO-планировщика
(начнёт готовить черновики статей на 35 дней — задания AI), поэтому в эту задачу не включено — решение за
владельцем; подробно — `problems.md`.
