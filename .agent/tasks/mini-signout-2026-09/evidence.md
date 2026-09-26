# Доказательства: «Выйти» в мини-приложении больше не входит обратно (mini-signout-2026-09)

Спека: [`spec.md`](spec.md) (заморожена 2026-09-26). Ветка `fix/mini-signout-2026-09-26` от `origin/master` (`deea027e`), код — коммит `d9b54ffc`, не запушено.

## Что изменилось для человека

- **«Выйти» в профиле мини-приложения** делает тот же полный выход, что сайт: `POST /api/auth/logout` гасит все куки сессии (и легаси-имена, которые ставит вход по телефону/почте) и куку оболочки, затем `signOut({ redirect: false })` next-auth. Сразу после того, как сервер подтвердил выход, ставится пометка «вышел вручную» (`localStorage["wesetup.mini.signed-out"]`, все обращения в try/catch), и открывается экран входа `/mini/login` (через `location.replace`, чтобы «назад» не вёл в профиль вышедшего). Если сервер выход не подтвердил — на экране «Не удалось выйти. Проверьте связь и попробуйте ещё раз.», человек остаётся в аккаунте, пометки нет.
- **Пока пометка стоит, `/mini` в Telegram сам не входит** по initData, а открывает экран входа (с сохранением `?next=`). Повторное открытие приложения из бота — тоже экран входа.
- **Экран входа внутри Telegram**: сверху «Войти через Telegram» (снимает пометку и уводит на `/mini` — вход по initData как раньше), под ним «или другой аккаунт» и обычная форма: переключатель «Телефон / Почта» и пароль. Вход по почте идёт через тот же `/api/auth/login`, что на сайте (вместе со вторым шагом — кодом из Telegram, если он включён). Вне Telegram кнопки Telegram нет, форма та же (переключатель «Телефон / Почта» появился и там).
- **Любой успешный вход снимает пометку**: «Войти через Telegram», телефон, почта, код из Telegram — явно; плюс мини-приложение снимает её всякий раз, когда видит живую сессию (вход на сайте в этом же браузере и т. п.).
- **Вне Telegram** после «Выйти» сессия больше не возвращается: раньше `signOut` снимал только куку next-auth, и по оставшейся легаси-куке сервер снова пускал человека.
- Попутно: экран входа в Telegram больше не уводит сам на `/mini`. Раньше из-за этого кнопка «Войти по телефону» с экрана ошибки («Аккаунт не связан с Telegram») возвращала к той же ошибке.

Не менялись: `POST /api/auth/logout`, выход с сайта (`header.tsx`), «Отвязать Telegram», проверка `initData`, вход по QR/PIN, киоск, схема БД.

## Как проверяли

- Стенд: личная БД `wesetup_wt_fix` (`prisma db push` + `prisma/seed.ts`); dev-сервер `NEXT_DIST_DIR=.next-e2e next dev --webpack -p 3044`, запущен из `C:/wt/fix`.
- Данные ([`e2e/setup.ts`](e2e/setup.ts)): «Кафе «Выход»», A — повар с привязанным Telegram (`992001`), B — повар с телефоном и паролем, руководитель с почтой и паролем.
- «Telegram» ([`e2e/tg.ts`](e2e/tg.ts)): настоящий `telegram-web-app.js` + эмулятор клиента `mini-sweep-2026-09/tg-host.js` + `initData`, подписанный токеном бота из `.env` (токен стендовый, выдуманный) — тот же путь `signIn("telegram")`, что в проде. «Открыть из бота» — новый адрес `/mini#tgWebAppData=…` со свежей подписью.
- Сценарии ([`e2e/run.ts`](e2e/run.ts)), Chromium из `%LOCALAPPDATA%\ms-playwright`, телефон 390×844 (сайт — ещё и 1440×900). Кто вошёл, спрашиваем у сервера двумя способами: `/api/mini/session` (getServerSession проекта — читает все имена кук, так человека видят страницы и API) и `/api/auth/session` (next-auth, `useSession`). После каждого «Выйти» ждём 7 с — успел бы вернуться автоматический вход.
- «До» — `PHASE=before` на исходном коде; «после» — `PHASE=after`, финальный прогон на коде коммита `d9b54ffc`: [`evidence/before/results.json`](evidence/before/results.json) — 14/19, [`evidence/after/results.json`](evidence/after/results.json) — **33/33**, повторов из-за пересборки dev-сервера — 0 (`devServerRetries: []`).
- Выдержки из лога сервера в момент «Выйти»: [`evidence/before/server-requests-S1.txt`](evidence/before/server-requests-S1.txt), [`evidence/after/server-requests-S1.txt`](evidence/after/server-requests-S1.txt).
- Снимки `evidence/*/*.png` лежат в папке задачи этой копии (`C:/wt/fix`); по правилу `.gitignore` `.agent/**/*.png` в git не попадают — как у остальных задач.

## Критерии приёмки

### AC1 — PASS: в Telegram после «Выйти» A не входит обратно сам; виден экран входа с «Войти через Telegram»; вход по паролю сотрудником B даёт сессию B

До (`before/results.json`, сценарий S1): после «Выйти» и 7 с — снова `/mini/me`, сервер: **A**, next-auth: **A** (`signout-stays-out` FAIL). В логе сервера: `POST /api/auth/signout` → `GET /mini` → `GET /mini?next=%2Fmini%2Fme` → `POST /api/auth/callback/telegram 200` → `GET /mini/me`. Снимок `before/tg-after-signout.png` — профиль Анны.

После (`after/results.json`, S1):

| Проверка | Результат |
|---|---|
| `signout-stays-out` | после «Выйти» и 7 с: экран `/mini/login`, сервер: нет сессии, next-auth: нет сессии |
| `login-screen` | на `/mini/login` есть «Войти через Telegram» и форма пароля (снимок `after/tg-after-signout.png`) |
| `mark-set` | `localStorage["wesetup.mini.signed-out"]` = отметка времени |
| `cookies-cleared` | кук `*session-token` после выхода нет |
| `reopen-from-bot` | снова открыли из бота со свежим initData → `/mini/login`, сессии нет |
| `signout-again` + `password-login-B` | второй выход → `/mini/login`; телефон и пароль B → `/mini/today`, сервер: **B**, next-auth: **B** (снимок `after/tg-logged-in-as-B.png`) |
| `mark-cleared-by-password` | пометки после входа по паролю нет |
| `email-login-owner` + `mark-cleared-by-email` | B вышел → «Почта» → почта и пароль руководителя → `/dashboard`, сессия руководителя, пометки нет (снимок `after/tg-login-by-email.png`) |

В логе сервера после правки: `POST /api/auth/logout` → `POST /api/auth/signout` → `GET /mini/login`, и никакого `callback/telegram`, пока человек сам не нажал «Войти через Telegram».

### AC2 — PASS: «Войти через Telegram» после выхода снова даёт сессию A

S1 после: `telegram-button-signs-in-A` — «Войти через Telegram» → `/mini/today`, сервер: **A**; `mark-cleared-by-telegram` — пометка снята (`null`). В логе: `GET /mini` → `POST /api/auth/callback/telegram 200` → `GET /api/mini/session 200`.

### AC3 — PASS: вне Telegram после «Выйти» на `/mini` сессии нет, открывается форма входа

Сценарий S2 — браузер телефона без Telegram, оболочка приложения (`ws-shell=mini`), вход B по телефону (куки `haccp-online.session-token` и `next-auth.session-token`).

- До: после «Выйти» → `/mini/today`, сервер: **B** (next-auth уже «нет сессии», но осталась кука `next-auth.session-token`) — `signout-no-session` FAIL. Снимок `before/browser-after-signout.png`.
- После: `signout-no-session` — `/mini/login`, сервер и next-auth: нет сессии, кук сессии нет; `mini-opens-login` — снова `/mini` → `/mini/login`, сессии нет (снимок `after/browser-after-signout.png`); `cabinet-in-shell` — страница кабинета `/journals` в оболочке → `/mini/login`, сессии нет (спека п. 4: «на телефоне с оболочкой мини-приложения сессия не возвращается»); `no-telegram-button-outside` — кнопки «Войти через Telegram» вне Telegram нет.

### AC4 — PASS: выход с сайта и «Отвязать Telegram» работают как раньше

Одинаково до и после (код этих путей не менялся):

- S3 компьютер 1440×900: вход на `/login` по почте → `/dashboard`; «Выйти» в шапке → `/login`, сессии и кук сессии нет; `/dashboard` → `/login`.
- S3 телефон 390×844 (сайт без оболочки): «Меню» → «Выйти» → `/login`, сессии нет; затем `/mini` в том же браузере → `/mini/login`, сессии нет.
- S4 Telegram: «Отвязать Telegram» (с вводом «ОТВЯЗАТЬ») → `User.telegramChatId = null`, `/mini` показывает «Аккаунт не связан с Telegram», сессии нет, пометка «вышел вручную» не ставится (снимки `before|after/tg-after-unlink.png`).
- Доп. (S4, не критерий): «Войти по телефону» с экрана ошибки — до: `/mini` (возвращало к ошибке), после: `/mini/login`.

### AC5 — PASS: typecheck и `npm test` зелёные, есть тесты на логику пометки

- `npm run typecheck` — без ошибок (отдельно и в pre-commit хуке коммита `d9b54ffc`).
- `npm test` — 2453 теста: 2453 pass, 0 fail. Pre-commit хук: проверка секретов, typecheck, `test:gate` (`pass=2453, fail=0`) — без `--no-verify`.
- Новые тесты [`src/app/mini/_lib/signed-out-mark.test.ts`](../../../src/app/mini/_lib/signed-out-mark.test.ts) — 20 шт.: пометка ставится/читается/снимается; пустое значение — не пометка; хранилище бросает или его нет (в т. ч. `window.localStorage` бросает SecurityError) — ничего не падает; `miniEntryStep` — в Telegram без пометки вход по initData, с пометкой экран входа, вне Telegram пометка ничего не меняет, полный цикл «вышел → вошёл → снова автовход»; `telegramSignInHref` — куда ведёт «Войти через Telegram» (в т. ч. отказ от чужих адресов и `/api`); `signOutOnThisDevice` — порядок `logout → пометка → signOut`, ошибка сервера/нет связи → исключение и без пометки, сбой или зависание `signOut` выход не отменяет.
- `npx eslint` по изменённым файлам — чисто.

### Доп.: сбой выхода

S5 (только «после»): `POST /api/auth/logout` отвечает 500 → на экране «Не удалось выйти. Проверьте связь и попробуйте ещё раз.», человек остаётся в профиле, сессия A, пометки нет (снимок `after/tg-logout-failed.png`).

## Изменённые файлы

- `src/app/mini/_lib/signed-out-mark.ts` (новый) — пометка (localStorage в try/catch), `miniEntryStep`, `telegramSignInHref`, `signOutOnThisDevice` (полный выход + пометка).
- `src/app/mini/_lib/signed-out-mark.test.ts` (новый) — тесты выше.
- `src/app/mini/me/me-client.tsx` — «Выйти» через `signOutOnThisDevice`, ошибка при сбое, переход на `/mini/login`, текст подтверждения.
- `src/app/mini/page.tsx` — при пометке в Telegram не входит сам, ведёт на `/mini/login?next=…`.
- `src/app/mini/_components/mini-session-provider.tsx` — снимает пометку при живой сессии; в Telegram не уводит на `/mini` с экрана входа и после ручного выхода.
- `src/app/mini/login/login-form.tsx` — «Войти через Telegram» (только в Telegram), переключатель «Телефон / Почта», снятие пометки при любом успешном входе; фокус в поле — эффектом и только вне Telegram (иначе клавиатура закрывала бы кнопку Telegram).
- Скрипты проверки: `.agent/tasks/mini-signout-2026-09/e2e/*`.

## Заметки и что осталось

- Порядок в «Выйти»: пометка ставится сразу после подтверждения `POST /api/auth/logout`, до `signOut` (в спеке — «потом помечает»). Так надёжнее: `signOut` меняет состояние сессии, и провайдер мини-приложения в этот момент уже видит пометку и не уводит на `/mini` параллельно переходу на экран входа. Если сервер выход не подтвердил, пометки нет.
- Вход по почте на экране мини-приложения — новое (спека: «форма по телефону/почте»): руководитель, который «вошёл за сотрудника», должен попасть в свой аккаунт, а он обычно почтовый.
- «Отвязать Telegram» по спеке не трогали. Разовая проба [`e2e/unlink-browser-probe.ts`](e2e/unlink-browser-probe.ts) → [`evidence/after/unlink-browser-probe.json`](evidence/after/unlink-browser-probe.json): в обычном браузере после входа по телефону отвязка снимает связь с Telegram, но сессия остаётся по легаси-куке — тот же дефект, что был у «Выйти». Кандидат в отдельную задачу: перевести отвязку на `signOutOnThisDevice`-подобный полный выход.
- Тексты «В Telegram вход произойдёт сам» на экранах `/mini/today` и `/mini/me` без сессии не менялись; после ручного выхода они чуть неточны (эти экраны без сессии в Telegram почти не видны — вход ведёт на экран входа).
- Второй шаг входа (код из Telegram при включённой защите) e2e не проверялся — на стенде выдуманный токен бота, код не доставить; путь использует тот же `finishLogin()`, что и вход по паролю.
- В консоли S2 бывает `[next-auth][error][CLIENT_FETCH_ERROR] … /api/auth/session` — фоновый запрос сессии обрывается переходом страницы на экран входа; на результат не влияет (было и до правки в S4).
- Dev-сервер webpack временами пересобирает общий чанк `app/layout`, пока страница его грузит (ChunkLoadError) — в скрипте есть повтор сценария именно в этом случае; в финальном прогоне повторов не было. На ранних прогонах «до» были и ошибки самого скрипта (нажатие до гидратации) — исправлены ожиданием гидратации, результаты «до» — из третьего, чистого прогона.
