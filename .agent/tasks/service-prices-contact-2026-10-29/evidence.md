# Evidence — цены услуг → «Свяжитесь с нами» (2026-10-29)

База: `origin/master` 3cc11530, ветка `feat/service-prices-contact-2026-10-29`,
worktree `F:\wt\svcprice`, локальная БД `wesetup_svcprice` (5432; прод 5433 не
трогали). Скриншоты — в `raw/screens/` (не коммитятся).

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 общий диалог | PASS | `src/components/contact/contact-us-dialog.tsx` (`ContactUsPanel`/`ContactUsDialog`/`ContactUsTrigger`/`ContactUsButton`), `src/lib/contact-us.ts` + `contact-us.test.ts`; e2e: телефон `tel:+79253058077`, 28 px на 1440, 24 px на 390, блок 25–365 из 390, Telegram `https://t.me/wesetupbot`, `mailto:support@wesetup.ru`, «Чат на сайте» закрывает окно и шлёт событие чата (1440, 390, Mini App) |
| AC2 `/uslugi` | PASS | e2e: в 12 карточках нет «₽», JSON-LD без `price`/`minPrice`/`offers`/`priceCurrency`, в разметке без `<script>` нет «₽»; тексты description/hero/шаг 3/FAQ переписаны; кнопка в hero |
| AC3 витрина тарифов | PASS | e2e `/`, `/pricing`, `/settings/subscription`: блок ППК и строка таблицы без цены, цены тарифов есть (1 990 / 3 990, в кабинете 1 891 / 3 791); юнит `tariff-comparison.test.ts` (ru/en/uz: кнопка, «по запросу», 4 триггера, нет суммы) |
| AC4 кабинет «Услуги» | PASS | e2e: 12 карточек без «₽», в `main` нет «₽», окно заявки без «₽/Оплатить/Спишем/баланс», с «Отправить заявку» и видимым телефоном; `payFromBalance` не отправляется (API не менялся, поле опционально) |
| AC5 `/inspection/experts` | PASS | e2e: блок без «₽», кнопка открывает окно |
| AC6 производственный контроль | PASS | e2e `/production-control`: блок ППК без «₽», кнопка открывает окно; `/production-control/documents/package` — тот же компонент `PpkIndividualOrder` |
| AC7 i18n | PASS | ключи удалены/добавлены в ru/en/uz; `npm run i18n:types` → `message-contract.d.ts`; `npm run i18n:check` — 97/97 |
| AC8 не тронуто | PASS | `git diff --stat`: нет `whats-new-notes.ts`, `deploy.yml`, `hardware-pricing.ts`, `public-chrome.tsx`, `/root/*`, `requests.ts` |
| AC9 проверки | PASS | см. ниже |

## Команды

- `NODE_OPTIONS=--max-old-space-size=10240 npm run typecheck` → exit 0
- `npx eslint <19 изменённых файлов>` → exit 0
- `node --import tsx --test src/lib/contact-us.test.ts src/components/pricing/tariff-comparison.test.ts src/lib/services/catalog.test.ts src/lib/plan-catalog.test.ts src/app/root/services/service-presentation.test.ts src/components/inspection/inspection-pages.test.ts src/lib/home-page.test.ts` → 35/35
- `npm run i18n:check` → 97/97
- `npm run test:gate` → pass=5094, fail=2: один из baseline, второй — сетевой
  `prewarm-routes.sh` (под нагрузкой); отдельный повтор — 2/2 (`raw/test-gate.txt`).
  Переписанные гейтом PDF в `english-version-*/raw` откачены.
- `node .agent/tasks/service-prices-contact-2026-10-29/raw/e2e-service-prices.mjs` (dev :3033) → 73/73, `raw/e2e-results.json`, `raw/e2e-run.log`

## Замечание

В оболочке Mini App dev-оверлей Next показывает «1 Issue» — расхождение
гидрации из-за `--tg-viewport-height`, который Telegram WebApp SDK вписывает в
DOM вне Telegram (единственная строка диффа гидрации — этот стиль, не
компоненты правки).
