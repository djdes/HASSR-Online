# Доказательства — memo-site-url-2026-10-28

| AC | Итог | Чем подтверждено |
| --- | --- | --- |
| AC1 | PASS | `print-brand-frame.test.ts`: сайт «https://dobroe-kafe.ru/» → в шапке `dobroe-kafe.ru` |
| AC2 | PASS | тот же тест: в подвале `wesetup.ru`, сайта организации там нет; без сайта — wesetup.ru и вверху, и внизу |
| AC3 | PASS | `brandingPage.siteHint` ru/en/uz, `npm run i18n:types`; пункт в «Плакаты, QR и этикетки в фирменном стиле» |
| AC4 | PASS* | тест 2/2, `npm run typecheck` — 0 ошибок, eslint — 0; `message-contract.test` падает только из-за CRLF в Windows-чекауте (известное) |

QR-наклейки и таблички (`qr-print-sheets.tsx`) и этикетки печатают сайт один раз — в
шапке, их не меняли.
