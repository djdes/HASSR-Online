# Evidence — редактор переводов (2026-10-24)

Проверка на текущем коде ветки, локальная PostgreSQL 16, `next dev`.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `prisma validate` ok; `prisma db push` создал `TranslationOverride` и `User.canEditTranslations` |
| AC2 | PASS | `translations.test.ts` (applyOverrides, loadMessages без БД); `raw/load-messages.txt`: правка en видна в `loadMessages("en")`, файл и ru не тронуты, сброс возвращает исходник |
| AC3 | PASS | `translations.test.ts`: unknown_key/locale, argument_mismatch, invalid_icu, corrupted, too_long, сброс пустым/равным; e2e: потеря `{dayLabel}` → 422 |
| AC4 | PASS | `translations.test.ts`: 16 020 ключей ровно один раз, первая категория — `journal-hygiene`, префиксы живые |
| AC5 | PASS | `raw/e2e-results.json`: 403 обычному, 404 на `/api/root/translators` не-root, сохранение, сброс, 149 категорий |
| AC6 | PASS | `raw/root-translations.png`, `raw/translator-editor.png` |
| AC7 | PASS | root-nav «Сайт → Переводы»; меню профиля сайта и `/mini/me` (`raw/translator-profile.png`); у обычного сотрудника пункта нет (e2e) |
| AC8 | PASS | `raw/seed-bootstrap.txt`: 1-й seed — «not found yet», 2-й — «granted 1», маркер `translators_bootstrap_2026_10` |
| AC9 | PASS | `npm run typecheck` exit 0; `npm run test:gate` pass=4712 fail=0; `i18n-types --check` ok; eslint по изменённым файлам — 0 ошибок |
| AC10 | PASS | `raw/e2e-results.json` — 15/15 PASS |

Ревью (независимый субагент) — исправлено: черновик не стирается, если строку
правили во время сохранения; автоперевод не затирает ручной черновик; чтение
правок ждёт БД не дольше 1,5 с; гонка сброса кэша (счётчик поколений);
параллельный сброс — `deleteMany`; выдача права — сначала точное совпадение почты.
Не исправлялось сознательно: переводчик правит все разделы (так просил владелец).

Автоперевод проверен только на уровне текста задания и разбора ответа (unit):
очередь ProjectsFlow локально не настроена.

## Смоук на проде после деплоя

`scripts/translations-smoke.mjs` и workflow `.github/workflows/translations-smoke.yml`
(только ручной запуск, только чтение). Логин и пароль — в секретах репозитория
`SMOKE_ROOT_EMAIL`, `SMOKE_ROOT_PASSWORD`, необязательно `SMOKE_TRANSLATOR_EMAIL`.
Локально: 5/5 PASS с верным паролем, exit 1 с неверным. Попутно: при остановленной
PostgreSQL страницы открывались, ошибка чтения правок ушла в лог.
