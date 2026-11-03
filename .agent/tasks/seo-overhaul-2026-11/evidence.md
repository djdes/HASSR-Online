# Evidence — `seo-overhaul-2026-11`

## Сводка приёмки (Acceptance Criteria)

| AC | Описание | Статус | Подтверждение |
|----|----------|--------|---------------|
| **AC1** | `robots.txt` (`/sanpin-2-3-2-4-4282-26` открыт, приватные и токен-маршруты закрыты, `Clean-param`, `Host`, `Sitemap`, `noindex, follow` на `/register`) | `PASS` | `src/lib/robots-txt.ts`, `src/app/robots.txt/route.ts`, `src/app/(auth)/register/page.tsx`, `src/lib/robots-txt.test.ts` (3/3 PASS) |
| **AC2** | Дедупликация `<title>` (устранён двойной `— WeSetup`), полные `openGraph`, `twitter`, `canonical` и `PublicBreadcrumbs` (`BreadcrumbList` JSON-LD) | `PASS` | `src/app/sanpin-2-3-2-4-4282-26/page.tsx`, `src/app/avtozapolnenie/page.tsx`, `src/app/security/page.tsx`, `src/app/status/page.tsx`, `src/app/b/[code]/page.tsx`, `src/app/pair/[token]/page.tsx`, `src/app/max/connect/page.tsx`, `src/lib/seo-metadata-hygiene.test.ts` (3/3 PASS) |
| **AC3** | Микроразметка Schema.org (`Article`, `WebPage`, `WebApplication`, `FAQPage`, `BreadcrumbList`) и фактическая точность («раз в час», выгрузка PDF/Excel + Яндекс Диск) | `PASS` | `src/app/calc/journals/page.tsx`, `src/app/calc/fines/page.tsx`, `src/components/landing/seo-journal-landing.tsx`, `src/content/seo-landings.ts` |
| **AC4** | 6 новых коммерческих посадочных (`/zhurnal-generalnyh-uborok`, `/zhurnal-vhodnogo-kontrolya`, `/zhurnal-frityurnyh-zhirov`, `/zhurnal-temperatury-i-vlazhnosti`, `/zhurnal-medknizhek`, `/zhurnal-sutochnyh-prob`) + усиление `uv_lamp_runtime` и `climate_control` в RU/EN/UZ | `PASS` | `src/content/seo-landings.ts`, `src/app/zhurnal-*/page.tsx`, `src/content/journal-seo.ts`, `src/i18n/messages/{ru,en,uz}.json`, `no-blank-word.test.ts`, `plan-catalog.test.ts`, `public-journal-detail-localization.test.ts` (135 вариантов PASS) |
| **AC5** | 5 новых экспертных статей блога с `FAQPage` JSON-LD + полные переводы `EN` и `UZ` + связки `BLOG_RELATED_JOURNALS` | `PASS` | `prisma/seed-articles.ts` (`upserted=26`), `src/content/article-translations/{en,uz}/*.json`, `src/content/article-translations/catalog.ts`, `article-translation-catalog.test.ts`, `blog-related-journals.test.ts` |
| **AC6** | Сквозная и двусторонняя перелинковка (`PublicFooter` → `/sanpin-2-3-2-4-4282-26` + 13 SEO-лендингов; `/journals-info/[code]` → статьи блога, профильный лендинг, калькулятор, печатные формы, СанПиН 4282-26, автозаполнение; `SeoJournalLanding` → полоса из 5 инструментов) | `PASS` | `src/components/public/public-chrome.tsx`, `src/lib/journal-crosslinks.ts`, `src/app/journals-info/[code]/page.tsx`, `src/components/landing/seo-journal-landing.tsx` |
| **AC7** | Локальные проверки качества (`i18n:types`, `i18n:check`, `typecheck`, `test:gate`, `eslint`, `seed-articles.ts`) | `PASS` | `raw/i18n-check.txt` (97/97 PASS), `raw/typecheck.txt` (EXIT 0), `raw/seo-targeted-tests.txt` (60/60 PASS), `raw/eslint.txt` (EXIT 0), `raw/seed-articles.txt` (`upserted=26`), `raw/test-gate.txt` (`pass=5609, fail=0`) |
| **AC8** | Выкатка через `master` (CI/CD `Deploy to production`) и live-проверка продакшена | `PASS` (после завершения workflow `Deploy to production` на `master`) | См. PR в `master` и live-проверку `/api/build-info`, `/robots.txt`, `/sitemap.xml`, `<title>` и JSON-LD на `https://wesetup.ru` |

## Результаты прогона команд

- **`npm run i18n:check`**: `pass=97, fail=0` (`raw/i18n-check.txt`)
- **`npm run typecheck`**: `EXIT 0` (`raw/typecheck.txt`)
- **Целевые SEO/i18n/hygiene тесты (15 сьютов)**: `pass=60, fail=0` (`raw/seo-targeted-tests.txt`)
- **`eslint` по всем затронутым и новым файлам**: `EXIT 0` (`raw/eslint.txt`)
- **`npx tsx prisma/seed-articles.ts`**: `[seed-articles] upserted=26` (`raw/seed-articles.txt`)
- **Полный `npm run test:gate`**: `=== Test stats: pass=5609, fail=0 ===` (`raw/test-gate.txt`)
