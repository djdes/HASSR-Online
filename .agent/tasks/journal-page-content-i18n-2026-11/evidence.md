# Evidence — journal-page-content-i18n-2026-11

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 en/uz у всех 45 | PASS | `journal-page-content-i18n.test.ts`: 90/90 (en 45, uz 45) — та же форма, что у ru. |
| AC2 числа штрафов, без кириллицы | PASS | Тот же тест: числа каждого пункта штрафа совпадают с ru, кириллицы нет; uz — ‘/’ как в uz.json. |
| AC3 страницы en/uz | PASS | `journalPageContent(code, locale)`; e2e (iPhone 13): /en и /uz hygiene, cleaning, fryer_oil, medical_waste_b, audit_report, finished_product — 200, образец/разделы/штрафы видны, ширина 390 (`raw/e2e.log`, `raw/*hygiene*.png`); ru без изменений. |
| AC4 проверки | PASS | Тесты контента 135/135, рендер 135 страниц ✓, typecheck ✓, test:changed ✓, eslint ✓ (`raw/checks.log`). |
| AC5 20 предложений SEO | PASS | Отчёт пользователю в чате (аудит wesetup.ru 2026-11-17). |
| AC6 мердж и деплой | — | Выполняется после коммита. |

Попутно найдено и исправлено: блок штрафов в ночной теме сайта был нечитаем (розовые тона без ночных значений) — переведён на тона «warn» из app-theme.css (`raw/uz-hygiene-journal-fines.png`, ночная тема).
