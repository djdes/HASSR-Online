# Problems Found During Live Production Verification (`AC8`)

При первичной live-проверке боевого `https://wesetup.ru` после деплоя PR `#120` (`c2a568fc`) выявлены и устранены 3 точечные проблемы:

1. **P1 (`AC5` / `AC8` — `prisma/seed-articles.ts` под флагом `RUN_LEGACY_DATA_SEEDS=1`):**
   - **Причина:** В `.github/workflows/deploy.yml` вызов `npx tsx prisma/seed-articles.ts` находился внутри блока `if [ "${RUN_LEGACY_DATA_SEEDS:-0}" = "1" ]; then`, предназначенного для миграций клиентских данных организаций. Поскольку `seed-articles.ts` делает исключительно идемпотентный `prisma.article.upsert` по `slug` (публичный блог, 0 клиентских записей), новые статьи не попали в боевую БД при обычном push-деплое.
   - **Исправление:** Вызов `npx tsx prisma/seed-articles.ts` перенесён наружу сразу после `npx tsx prisma/seed.ts` под `set -o pipefail`.

2. **P2 (`AC6` — ранжирование связанных статей блога на `/journals-info/[code]`):**
   - **Причина:** `relatedBlogArticlesForJournal` брал первые 4 совпадения из `BLOG_RELATED_JOURNALS` в порядке объявления, из-за чего обзорные статьи в начале словаря вытесняли новые профильные разборы (например, `chek-list-priemki-syrya-v-restorane` для `incoming_control`).
   - **Исправление:** Кандидаты сортируются по `[codes.indexOf(code), codes.length]` (профильные статьи, где журнал основной и список узкий — первыми) с лимитом `5`; добавлен юнит-тест `src/lib/journal-crosslinks.test.ts`.

3. **P3 (`AC5` — кодировка не-ASCII типографики в JSON-переводах статей `en`/`uz`):**
   - **Причина:** Новый тест `src/lib/journal-crosslinks.test.ts` выявил, что при промежуточном копировании генератора через PowerShell `Get-Content` без `-Encoding UTF8` апострофы и тире (`‘`, `—`, `°`, `−`) в 10 файлах `src/content/article-translations/{en,uz}/*.json` перекодировались через CP1251.
   - **Исправление:** Переводы перегенерированы напрямую через Node `fs.readFileSync(..., "utf8")` / `fs.writeFileSync(..., "utf8")` и проверены тестами `article-translation-catalog.test.ts` и `journal-crosslinks.test.ts` на полное отсутствие кириллицы/моджибейка в `en` и `uz`.
