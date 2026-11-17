# Evidence — journal-page-engagement-2026-11

Проверено 2026-11-17 на локальном dev-сервере (`next dev`, Postgres) и командами репозитория.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 полоса на телефоне | PASS | `journal-sticky-bar.tsx`; e2e (iPhone 13): `data-visible` false на первом экране, true в середине, false у финального блока (`raw/e2e.log`, `raw/mobile-*.png`); «Контакты»/«Чат» подняты через `--public-sticky-offset`. На ПК полоса скрыта. |
| AC2 конструктор | PASS | `blank-constructor(-client).tsx`, `lib/blank-layout.ts` (+тест), `BlankExtras.layout`, PDF-роут печатает свой бланк `renderPaperJournalPdfDetailed`. e2e: название изменено, +колонка «Примечание», 30 строк → `blank-cleaning.pdf` 400 KB, 10 колонок, шапка, QR (`raw/constructor.png`, `raw/custom-blank-p1-1.png`). Telegram-строка «🧩 Свой бланк…». |
| AC3 образец строками + видео | PASS | `journal-sample-rows`, `journal-video` (ru) — `raw/sample-rows.png`, `raw/e2e.log`. |
| AC4 разделы и штрафы | PASS | 5 разделов `journal-text-section` + `journal-fines` (ст. 6.6, 6.3, 14.43 КоАП) — `raw/fines.png`. |
| AC5 отзывы + счётчик | PASS (по коду) | Блок `journal-reviews` рендерится при одобренных отзывах (`listPublicReviews(6)`); счётчик «N организаций ведут» — от 20 (`journalUsageCount`, без демо и platform). В локальной базе одобренных отзывов нет — блок корректно скрыт; на проде отзывы есть. |
| AC6 превью картинкой | PASS | `/api/journal-samples/cleaning/preview` → 200 `image/webp` 54 KB, кеш сутки; на странице `<img>` naturalWidth 1100, ссылка на PDF целиком; видно и на телефоне. |
| AC7 «Кому нужен» | PASS | `journal-audience`: ниши, где журнал включён по умолчанию или рекомендован сфере (для уборки — 14 ниш, показываются 8). |
| AC8 финальный блок | PASS | `journal-final-cta` (`raw/final-cta.png`). |
| AC9 QR первой записи | PASS | Ответ `/api/public/blank-download` → `firstEntryQr` при созданном кабинете; e2e: окно «Сделайте первую запись прямо сейчас» с QR (`raw/done-first-entry.png`). |
| AC10 SEO | PASS | `raw/metrics-cmp.txt`: было 723 слова / 10 вхождений / 1,38 %; стало 1373 слова / 11 / 0,80 %, 17 H2/H3, 2 таблицы. Топ (веб-поиск; Яндекс из облака закрыт капчей): медиана 978 / среднее 1291 слов, вхождений 5 / 8,3, плотность 0,36 / 0,5 % (лидер well-clean 1,36 %), заголовков 5 / 10,4. 5 из 11 вхождений — общий шаблон FAQ всех журналов. |
| AC11 проверки | PASS | `npm run typecheck` ✓, `npm run test:changed` 356/356 ✓, eslint ✓ (`raw/checks.log`); i18n ru/en/uz + `i18n:types`; `palette:neutral`. |

Попутно: на 390 px шапка сайта не влезала (поиск + язык + «Тарифы» + «Войти» ≈ 452 px) — на телефоне «Тарифы» скрыты (есть в меню/подвале), «Войти» — значком, подпись логотипа скрыта < 360 px. Колонке страницы журнала добавлен `min-w-0` — таблицы больше не растягивают страницу по ширине (на проде страница была 892 px при экране 390).
