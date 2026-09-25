# Evidence — «Посоветуете WeSetup коллегам?»: шкала 1–5, рекомендация коллеге по почте

Ветка `feat/nps-2026-09-25`, worktree `C:/wt/qrforms`, база `wesetup_wt_qrforms`, dev `http://localhost:3042`
(`NEXT_DIST_DIR=.next-e2e node node_modules/next/dist/bin/next dev --webpack -p 3042`, после проверки сервер
остановлен, `.next-e2e` удалён, `tsconfig.json` возвращён). Спецификация и код — коммит `85110ea5`.

## Что сделано
- **Схема**: `NpsResponse.scale Int @default(10)` — единственное изменение. Порядок: правка схемы →
  `prisma db push` в `wesetup_wt_ui`, `wesetup_wt_pdf`, `wesetup_wt_qrforms`, `wesetup_wt_blanks` → `prisma generate`
  (`raw/schema-push.log`). `db push` в каждой базе заодно снимал частичный индекс
  `PartnerClient_one_active_per_org` (Prisma его не описывает, приложение создаёт лениво в
  `src/lib/partners/schema-extras.ts`) — сразу после push он восстановлен тем же SQL (`CREATE UNIQUE INDEX IF NOT
  EXISTS …`), итог в каждой базе: колонка `scale integer NOT NULL DEFAULT 10` + индекс на месте (проверка в том же логе).
- **Правила и расчёт** — `src/lib/nps.ts` (client-safe): шкалы 5/10, `npsCategory` (1–5: 5 промоутер, 4 нейтральный,
  1–3 критик; 0–10 как раньше), `computeNpsReport` (общий NPS + по каждой шкале со средней и распределением),
  `computeNps` для старых вызовов без изменений, разбор тел `POST`/`PATCH /api/nps`, лимиты и текст по умолчанию.
- **API** `src/app/api/nps/route.ts`: `POST { score, scale: 5 }` — новый ответ (в ответе `id`), `POST { score, comment? }`
  без `scale` — старый формат 0–10 как раньше, `POST { dismiss: true }` — «не сейчас»; новый `PATCH { id, score?, comment? }`
  — свой ответ в течение суток (смена оценки 4→5, «Что улучшить?»).
- **Рекомендация** — `src/lib/nps-recommend.ts` (логика с внедряемыми зависимостями) + `src/app/api/nps/recommend/route.ts`
  (база/почта): только после своей оценки 4–5 по шкале 1–5; проверка почты (`checkEmail` + MX через `domainAcceptsMail`);
  не своя почта (логин и контактная) и не почта сотрудника/участника своей организации; ≤ 5 писем в сутки на человека,
  ≤ 20 на организацию, один адрес — раз в сутки; текст ≤ 1000 символов; проверка лимитов и отправка под
  advisory-замком организации (`withAdvisoryTryLock`); AuditLog `nps.recommend`, сущность `NpsResponse`,
  детали `{ colleagueEmail, referral, npsScore, delivery }` — без текста письма. Понятные ошибки с полем (`field`).
- **Письмо** — `src/lib/email.ts`: `buildColleagueRecommendationEmail` / `sendColleagueRecommendationEmail` рядом с
  остальными `send*Email`: от WeSetup (`SMTP_FROM`), в теме и тексте — имя и организация рекомендующего (имя-заглушку
  не пишем: «Коллега из «…»»), его текст экранирован (`escapeHtml`, `pre-wrap`), кнопка и ссылка на регистрацию:
  реферальная `/r/<код>?email=…`, если у организации есть код клиентской программы, иначе `/register?email=…`;
  Reply-To — контактная почта или логин рекомендующего (служебные `*.local` пропускаются). Транспорт получил `replyTo`;
  в dev (пустой `SMTP_HOST`) письмо целиком пишется в лог вместе с Reply-To; `isEmailDeliveryConfigured()` отличает
  «записано в лог» от сбоя отправки.
- **Блок** `src/components/layout/nps-banner.tsx` (и сайт, и Mini App): «Посоветуете WeSetup коллегам?» в одну строку,
  подпись убрана, шкала 1–5 кнопками 48 px в одну строку с краями «нет»/«да»; оценка сохраняется по клику;
  4–5 — «Почта коллеги», «Сообщение» (текст по умолчанию, можно править), «Отправить», подсказка «Письмо придёт от
  WeSetup с вашим именем…»; 1–3 — «Что улучшить?» + «Отправить» (сохраняется в `comment` этого ответа). После отправки —
  «Спасибо! Письмо отправлено» / «Спасибо! Учтём», блок скрывается. Крестик до оценки — «не сейчас», после — просто
  закрыть (оценка уже сохранена). В `(dashboard)/layout.tsx` блок теперь всегда в дереве (`<NpsBanner ask={askNps} />`):
  после оценки `askNps` становится false, а дашборд делает `router.refresh()` по живым событиям — без этого форма
  пропадала посреди ввода (поймано e2e). Правила показа (`askNpsFor`) не менялись.
- **Куда уходят комментарии NPS**: поиск (`grep -ri nps src`) — только `NpsResponse.comment` и список на `/root/nps`,
  уведомлений нет → «Что улучшить?» только сохраняется, как и раньше.
- **`/root/nps` и `GET /api/root/nps`**: общий NPS по обеим шкалам + отдельно «Шкала 1–5» и «Шкала 0–10 (ответы до
  сентября 2026)» — NPS, средняя, распределение столбиками по каждой оценке; в списке ответов — «5 из 5» / «9 из 10» и
  пометка «письмо коллеге». В JSON `last90`/`allTime` сохранили форму (`NpsSummary`), добавлены `byScale` и `scale` у ответов.
- **Журнал действий**: подписи «Рекомендация WeSetup коллеге», «Почта коллеги», «Реферальная ссылка», «Оценка», «Доставка».

## Критерии приёмки

| AC | Статус | Доказательства |
|---|---|---|
| AC1: 390 px — заголовок в одну строку, шкала 1–5 в одну строку (скриншоты 390 и 1440) | PASS | `evidence/ac1-390-ask.png`, `evidence/ac1-1440-ask.png`; `raw/e2e-results.json`: 390 — строк заголовка 1 (текст 257 px в блоке 276 px), 5 кнопок на одной высоте, 49×48 px, `scrollWidth 390`; `raw/e2e-results-2.json`: 1440 — заголовок, шкала и крестик в одной строке (центры 136/138/138). Mini App: `evidence/mini-390-recommend-form.png` (заголовок 1 строка) |
| AC2: 4–5 → почта и сообщение, письмо коллеге с текстом и (реферальной) ссылкой; лимиты и запрет своей почты; AuditLog (e2e на своей базе) | PASS | `evidence/ac2-390-recommend-form.png`, `evidence/ac2-1440-recommend-form.png`, `evidence/ac2-390-own-email-error.png`; `raw/e2e-results.json` (35/36, единственный FAIL — ложный, см. ниже): клик 5 → ответ `score 5, scale 5`; своя контактная почта в другом регистре и логин → 400 «Это ваша почта…»; почта сотрудника → 400; отказы не пишут AuditLog; отправка → 200 «Спасибо! Письмо отправлено», блок скрыт; повтор на тот же адрес → 429; с кодом организации → `referral: true`; письма №3–5 → 200, 6-е → 429 «Не больше 5 рекомендаций в сутки»; текст 1001 символ → 400 (`field: message`); кривая почта → 400. `raw/email-dev-log.txt`: тема «Денис Управляющий из «Ресторан «Вкусная Гавань»» советует WeSetup», `Reply-To: denis.manager@example.com`, текст пользователя экранирован (`&lt;b&gt;тест&lt;/b&gt;`), ссылка `…/register?email=colleague1%40example.com` без кода и `…/r/E2EWSTQR?email=colleague2%40example.com` с кодом. `raw/db-state-after-e2e.json`: 5 строк AuditLog `nps.recommend` с `colleagueEmail`, `referral`, `npsScore`, `delivery`, без текста. Юнит: `src/lib/nps-recommend.test.ts`, `src/lib/email-colleague-recommendation.test.ts` |
| AC3: 1–3 → «Что улучшить?», комментарий сохранён | PASS | `evidence/ac3-390-improve.png`; `raw/e2e-results.json`: форма «Что улучшить?» без полей письма, `PATCH /api/nps` 200, в базе `score 2, scale 5, comment "Хочется выгрузку журналов одним архивом"` |
| AC4: `/root/nps` считает обе шкалы; старые ответы 0–10 не сломаны (тест) | PASS | `evidence/ac4-1440-root-nps.png`; `raw/e2e-results.json`: `/root/nps` 200, блоки обеих шкал; `GET /api/root/nps` — общий NPS 20 (5 ответов: 3 промоутера, 2 критика), шкала 1–5 NPS 33 (3), шкала 0–10 NPS 0 (2); старый формат `POST {score: 9}` → 200 и `scale = 10`, `{score: 0, scale: 5}` → 400, `{scale: 7}` → 400. Юнит `src/lib/nps.test.ts`: старые ответы без `scale` считаются как прежний `computeNps` (NPS 0, средняя 7.2), категории обеих шкал, смешанный отчёт, `parseNpsAnswer` старого и нового формата |
| AC5: typecheck и `npm test` зелёные | PASS | `raw/typecheck.log` (exit 0); `raw/npm-test-summary.log`: 2275 тестов, 2275 pass, 0 fail (было 2238); pre-commit (секреты + typecheck + test:gate) прошёл на `85110ea5`; `npx eslint` по изменённым файлам — без замечаний |

Про FAIL в `raw/e2e-results.json` «1440: заголовок и шкала в одной строке»: проверка сравнивала высоту блока заголовка
с отступом `pt-3` (32 px) с высотой строки — ложное срабатывание (верх заголовка и кнопок совпадал: 114/114).
Перепроверено по строкам текста и центрам в `raw/e2e-results-2.json` — PASS. Там же: устойчивость к `router.refresh()`
после оценки (форма и введённая почта остались), крестик после оценки не шлёт «не сейчас», крестик до оценки — шлёт.
Размер шрифта поля «Сообщение» на 390 px — 16 px: это глобальное правило против зума iOS (`globals.css`), текст по
умолчанию виден целиком.

## Как повторить e2e
Подготовка своей базы (`raw/e2e-db-prep.log`): организации `cmugz8a670000kw9mfvb6611i` дата создания −30 дней
(опрос — организациям старше двух недель), у `admin@haccp.local` — `npsAskedAt = null`, `showWhatsNew = false`,
`contactEmail = denis.manager@example.com` (проверка Reply-To). После прогона всё возвращено, ответы и AuditLog
прогона оставлены в базе. Скрипты: `raw/e2e-nps.cjs`, `raw/e2e-nps-2.cjs`, `raw/e2e-mini.cjs` (playwright-core,
Chromium из `%LOCALAPPDATA%\ms-playwright`, headless). Письма настоящие не отправлялись: `SMTP_HOST` пуст, адреса —
только `example.com`.

## Открытые вопросы
- Mini App: `src/app/mini/_components/mini-app-shell.tsx` по-прежнему рисует блок только при `askNps` — потянуть
  «обновить» во время ответа уберёт форму (оценка сохранена). Файлы `src/app/mini/*` в этой задаче трогать нельзя;
  исправление — одна строка: `<NpsBanner variant="mini" ask={askNps} />`.
- Реферальный код не создаётся для рекомендации (по спецификации — «если есть»); у организаций, не открывавших
  «Баланс и бонусы», ссылка обычная. Можно вызывать `ensureReferralCode`, чтобы бонус был всегда.
- Рекомендации из опроса не попадают в список приглашений «Баланс и бонусы» (`ReferralInvite`) — при желании можно
  писать и туда, чтобы человек видел статус «зарегистрировался/оплатил».
