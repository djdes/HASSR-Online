# Evidence — blank-download-extras-2026-11

Проверено 2026-11-17 на текущем коде ветки `claude/journal-download-form-xnfgqk`, локальная PostgreSQL + `next dev`.

| AC | Итог | Доказательство |
|----|------|----------------|
| AC1 две галки, без рассылки | PASS | `raw/e2e.json`: `checkboxes: 2`, `marketingPresent: 0`, `registerChecked: true`; тело запроса без `marketing`. Тест `blank-download-localization.test.ts` (ru/en/uz). Сервер по-прежнему принимает `marketing` (`blank-download.test.ts`). |
| AC2 почта не прыгает | PASS | `raw/e2e.json`: `heightsWhileTyping: [606]` — высота окна одна на всех 17 символах `bugdenes@gmail.co`; подсказка опечатки — кнопка `gmail.com?` внутри поля (`raw/2-typo.png`), исправляет на `gmail.com`. Ошибка — одна короткая строка только после ухода с поля. |
| AC3 «Дополнительно» по журналу | PASS | `raw/3-extras.png` (гигиенический: ответственный + сотрудники), `raw/5-mobile-cold.png` (холодильники, 390 px, без горизонтального скролла). Тесты разделов и разбора API — `blank-download-extras.test.ts`. Тексты в ru/en/uz, `i18n:types` перегенерирован. |
| AC4 чистка и счётчик | PASS | `blank-download-extras.test.ts`: лимиты 10 строк/80 символов, чужие разделы отбрасываются, мусор → `null`, счётчик. |
| AC5 данные в файле | PASS | Тест генерирует PDF (pdfjs) и Word: сотрудники и должности в гигиеническом, холодильники в журнале температур, свои помещения в уборке и климате (без помещений образца), ответственный — в строке «Должность ответственного» PDF и строкой «Ответственный: …» в Word. Скачанный по ссылке e2e Word содержит «Петров Сергей», «Сидорова Анна», «Повар». Ограничение: Word-вариант уборки — реестр без помещений (так было и раньше). |
| AC6 кабинет и QR | PASS | После e2e в БД: организация с `timezone = Asia/Yekaterinburg` (из браузера), сотрудники «Иванова Мария Петровна / Заведующая (manager)», «Петров Сергей / Сотрудник», «Сидорова Анна / Повар». Токен ссылки несёт `k` и `o`; `/qj/<org>/hygiene/<sig>` → 307 на `/journal-fill/<org>/…`. Без кабинета — `/qb/…` (тест `blankFileQrUrl`). |
| AC7 Telegram | PASS | `raw/tg-sample.txt` (живой запрос гео): `🇷🇺 Россия, Москва · местное время 15:11 (UTC+3)` и `➕ Доп. данные: 4 (ответственный, сотрудники — 3)`. Тесты `ip-geo.test.ts`, `blank-download-extras.test.ts`. |
| AC8 карточка клиента | PASS | `raw/6-root-card.png`: под IP регистрации «🇷🇺 Россия, Москва», «Местное время клиента 17:13 UTC+5 · Asia/Yekaterinburg». |
| AC9 проверки | PASS | `npm run typecheck` — чисто. `npm run test:changed` (эскалация до полного: 99 файлов) — `raw/test-changed.log`: pass 6228, fail 6; все 6 падают так же на чистом master (проверено `git stash`: root-organization-management-localization, perishable-rejection-lifecycle, journal-doc-guide-localization, staff-training-presentation ×2, ppe-issuance-presentation) — не регрессии. |
