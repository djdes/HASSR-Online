# SEO Overhaul 2026-11 — Превосходство WeSetup над `haccp-online.ru` и захват органического спроса РФ/СНГ

- **Task ID:** `seo-overhaul-2026-11`
- **Frozen At:** `2026-11-03T16:58:00+03:00`
- **Base Commit (`origin/master`):** `f90b4afb`
- **Branch:** `feat/seo-overhaul-2026-11`

## Контекст и данные аудита (Similarweb `Jul–Sep 2026` + аудит live-выдачи)

1. **Конкурентная картина (Similarweb `Jul–Sep 2026`):**
   - `wesetup.ru`: `1 471` визитов за квартал (`736/мес`), `Pages/visit = 1.02`, `Bounce = 40.42%`, доля мобильных `62%`. Уже забрал **100% органического трафика** по кластеру `бактерицидный журнал для …` (`8.19%`), но теряет глубину просмотра из-за слабой внутренней перелинковки.
   - `haccp-online.ru`: `42 720` визитов за квартал (`14 240/мес`), слабая органика (`<10%`), зависимость от платного трафика (`~23%`: Paid Search `11.89%` + Display `11.38%`), 0 схем JSON-LD на посадочных и журнальных страницах, одинаковый шаблонный `meta description` на всех страницах журналов, 0% видимой доли в КЗ/РБ/УЗ. Топ платных запросов: `хассп журналы и их заполнение` (`40.14%`), `бракеражный журнал готовой продукции` (`17.61%`), `санпин ...` (`16.90%`), `журнал проведения генеральных уборок` (`16.90%`), `журналы по хассп для пищевого производства` (`5.63%`).
   - `checkoffice.ru`: `108 861` визитов (`65.14%` органики), топ-кластеры пищевой безопасности: `чек-лист приемки сырья в ресторане` (`11.26%`), `условия хранения продукции` (`8.19%`).
2. **Технические дефекты `wesetup.ru` на `f90b4afb`:**
   - В `src/app/robots.ts` правило `Disallow: /sanpin` по префиксу блокирует публичную страницу `/sanpin-2-3-2-4-4282-26`, присутствующую в `sitemap.xml`.
   - В `robots.txt` нет директив Яндекса `Clean-param:` для склейки UTM/рекламных меток и не перечислены новые приватные и токен-маршруты (`/master`, `/kp/`, `/policy/`, `/pair/`, `/q/`, `/qb/`, `/qj/`, `/r/`, `/unsubscribe/`, `/inspector-sheet/`, `/max/`, `/order/`, `/payment/`, `/promo/` и новые разделы `(dashboard)`).
   - Из-за `title.template: "%s — WeSetup"` в корневом `layout.tsx` страницы `/sanpin-2-3-2-4-4282-26`, `/avtozapolnenie`, `/security`, `/status` (и служебные `/b/[code]`, `/pair/[token]`, `/max/connect`) рендерят двойной бренд `— WeSetup — WeSetup`.
   - Экран `/register` (`/en/register`, `/uz/register`) открыт к индексации (`index: true`), хотя `/login` закрыт `noindex, follow`, а комментарий в `sitemap.ts` прямо фиксирует вред служебных auth-экранов для краулингового бюджета.
   - На `/sanpin-2-3-2-4-4282-26`, `/security`, `/status` отсутствуют полные `openGraph`/`twitter` карточки; на `/calc/journals`, `/calc/fines` и в `SeoJournalLanding` нет расширенной разметки `FAQPage` / `WebApplication`; страница `/sanpin-2-3-2-4-4282-26` отсутствует в сквозном подвале `PublicFooter`.
   - В `temperaturnyy-list-holodilnika` указано «каждые 15 минут» вместо фактического «раз в час» (`tuya-pull`), а в `SeoJournalLanding` — «Бэкапы каждые 6 часов» вместо реальной выгрузки PDF/Excel и авто-бэкапа на Яндекс Диск.

## Критерии приёмки (Acceptance Criteria)

### AC1 — `robots.txt` и гигиена обхода / индексации
- `Disallow: /sanpin` заменён на `/sanpin/` и `/sanpin$`, так что `/sanpin-2-3-2-4-4282-26` полностью открыт для поисковых роботов.
- Закрыты от обхода приватные разделы кабинета (`/acknowledge`, `/checklists`, `/edo`, `/home`, `/ideas`, `/inspection/` + `/inspection$`, `/knowledge`, `/master/` + `/master$`, `/mercury`, `/monitoring`, `/more`, `/orders/` + `/orders$`, `/production-control`, `/translations`) и служебные/токен-маршруты (`/kp/`, `/policy/`, `/pair/`, `/q/`, `/qb/`, `/qj/`, `/r/`, `/unsubscribe/`, `/inspector-sheet/`, `/max/`, `/order/`, `/payment/`, `/promo/`).
- Маршрут `/robots.txt` (`src/lib/robots-txt.ts` + `src/app/robots.txt/route.ts`) отдаёт `Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&etext&from&ref`, `Host: https://wesetup.ru` и `Sitemap: https://wesetup.ru/sitemap.xml`.
- На `/register` (`/register`, `/en/register`, `/uz/register`) установлен `robots: { index: false, follow: true }`.
- Юнит-тест `src/lib/robots-txt.test.ts` проверяет, что ни один публичный URL сайта (все статические и динамические публичные маршруты из `sitemap.ts`, включая `/sanpin-2-3-2-4-4282-26`, `/partners`, `/partner-agreement`, `/journals-info/*`, ниши, SEO-лендинги, сравнения, города и статьи) не блокируется `robots.txt`, а приватные и токен-маршруты блокируются.

### AC2 — Дедупликация `<title>` и полнота метаданных (OG, Twitter, Breadcrumbs)
- Убран дублирующий суффикс `— WeSetup` из строковых `title` на `/sanpin-2-3-2-4-4282-26`, `/avtozapolnenie`, `/security`, `/status`, `/b/[code]` (fallback), `/pair/[token]`, `/max/connect`.
- Добавлен автоматический тест-страж `src/lib/seo-metadata-hygiene.test.ts`, проверяющий отсутствие строковых `title` с `— WeSetup` без `{ absolute: ... }` во всём `src/app/`.
- Добавлены `openGraph`, `twitter` и `canonical` на `/sanpin-2-3-2-4-4282-26`, `/security`, `/status`, а также `twitter` на `/avtozapolnenie`.
- На `/sanpin-2-3-2-4-4282-26`, `/security` и `/avtozapolnenie` добавлены видимые хлебные крошки `PublicBreadcrumbs` (генерирующие валидный `BreadcrumbList` JSON-LD).

### AC3 — Микроразметка Schema.org / Rich Snippets и фактическая точность
- На `/sanpin-2-3-2-4-4282-26` добавлен `Article` JSON-LD (в дополнение к `FAQPage` и `BreadcrumbList`).
- На `/security` и `/avtozapolnenie` добавлен `WebPage` JSON-LD (в дополнение к `BreadcrumbList` и `VideoObject`).
- На `/calc/journals` и `/calc/fines` добавлены видимый FAQ-блок и микроразметка `WebApplication` + `FAQPage` JSON-LD.
- В `SeoJournalLanding` (`src/components/landing/seo-journal-landing.tsx` + `src/content/seo-landings.ts`) добавлены профильные вопросы-ответы (`faq`) и разметка `FAQPage` JSON-LD; исправлены фактические формулировки: в `temperaturnyy-list-holodilnika` датчики пишут показания «раз в час» (как в `tuya-pull`), а в общем списке преимуществ указана выгрузка в PDF/Excel и копия на Яндекс Диск.

### AC4 — Коммерческие посадочные под платный и органический спрос конкурентов
- Добавлены 6 новых коммерческих SEO-лендингов в `src/content/seo-landings.ts` (после существующих 7 ключей) с серверными роутами `src/app/<slug>/page.tsx` и переводами в `publicNavigation.journals` (`ru.json`, `en.json`, `uz.json`):
  1. `/zhurnal-generalnyh-uborok` (`relatedCode: "general_cleaning"`)
  2. `/zhurnal-vhodnogo-kontrolya` (`relatedCode: "incoming_control"`)
  3. `/zhurnal-frityurnyh-zhirov` (`relatedCode: "fryer_oil"`)
  4. `/zhurnal-temperatury-i-vlazhnosti` (`relatedCode: "climate_control"`)
  5. `/zhurnal-medknizhek` (`relatedCode: "med_books"`)
  6. `/zhurnal-sutochnyh-prob` (`relatedCode: "daily_samples"`)
- Расширены ключевые фразы и описание `uv_lamp_runtime` в `src/content/journal-seo.ts` и синхронно в `src/i18n/messages/{ru,en,uz}.json` (`publicJournalDetailSeo.uv_lamp_runtime`) под кластер «бактерицидный журнал / учёт работы бактерицидной установки» без создания конкурирующего URL-дубля; также синхронизировано фактическое описание `climate_control` («раз в час» для Wi-Fi датчиков вместо «каждые 5–10 минут»).
- Все новые тексты строго соблюдают правила `no-blank-word.test.ts` и `plan-catalog.test.ts`.

### AC5 — Контентное покрытие блога (РФ + СНГ на RU/EN/UZ)
- В `prisma/seed-articles.ts` добавлены 5 новых экспертных статей с блоками `faq` (автоматический `FAQPage` JSON-LD):
  1. `chek-list-priemki-syrya-v-restorane`
  2. `programma-proizvodstvennogo-kontrolya-obshchepit`
  3. `markirovka-produktov-i-zagotovok-na-kuhne`
  4. `usloviya-i-sroki-hraneniya-produktov-obshchepit`
  5. `obrabotka-yaic-i-sutochnye-proby-sanpin`
- Для каждой из 5 статей созданы полные переводы `src/content/article-translations/en/<slug>.json` и `src/content/article-translations/uz/<slug>.json` с валидным `sourceHash`, зарегистрированные в `src/content/article-translations/catalog.ts`.
- Все 5 статей привязаны к журналам каталога в `src/lib/blog-related-journals.ts`.

### AC6 — Архитектура внутренней перелинковки (рост глубины просмотра с `1.02 Pages/Visit`)
- В сквозной `PublicFooter` (`src/components/public/public-chrome.tsx` + `ru/en/uz` в `publicChrome.sanpin4282`) добавлена ссылка на `/sanpin-2-3-2-4-4282-26`.
- На страницах журналов `/journals-info/[code]` добавлен блок полезных связей: обратные ссылки на тематические статьи блога (по `BLOG_RELATED_JOURNALS`), ссылка на профильный SEO-лендинг (если сопоставлен `relatedCode`, для RU), ссылки на `/calc/journals`, `/blanki` и `/sanpin-2-3-2-4-4282-26` с корректной локализацией RU/EN/UZ.
- В `SeoJournalLanding` добавлен навигационный блок инструментов (`/calc/journals`, `/calc/fines`, `/blanki`, `/prikazy`, `/avtozapolnenie`).

### AC7 — Локальные проверки качества (Quality Gates)
- `npm run i18n:types` и `npm run i18n:check` — EXIT 0.
- `npm run typecheck` — EXIT 0.
- `npm run test:gate` — EXIT 0 (0 новых падений).
- `npx eslint` по всем затронутым файлам — EXIT 0.
- `npx tsx prisma/seed-articles.ts` на локальной БД — EXIT 0.

### AC8 — Выкатка в `master` и проверка живого продакшена
- Ветка влита в `master` через чистый squash-merge PR без конфликтов.
- Workflow `Deploy to production` завершился успешно, `/api/build-info` отдаёт актуальный SHA.
- На боевом `https://wesetup.ru` проверены: `/robots.txt`, `/sitemap.xml`, отсутствие `— WeSetup — WeSetup` в `<title>`, `noindex, follow` на `/register`, наличие JSON-LD и код `200 OK` на обновлённых страницах, новых коммерческих лендингах и новых статьях блога (`ru`/`en`/`uz`).
- Артефакты доказательств (`evidence.md`, `evidence.json`, `raw/*`) сохранены в `.agent/tasks/seo-overhaul-2026-11/`.
