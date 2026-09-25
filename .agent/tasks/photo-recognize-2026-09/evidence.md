# Evidence: «Распознать с фото» (photo-recognize-2026-09)

Ветка `feat/photo-2026-09-25` (worktree `C:/wt/qrforms`), код — коммит `b0a5917f`.
Спецификация: [spec.md](spec.md). Сырые артефакты — папка [evidence/](evidence/).

| AC | Статус | Коротко |
|----|--------|---------|
| AC1 | PASS | Воркер `-TestImage`: кириллическое меню → точный JSON 5/5; нечитаемая картинка → `{"items":[]}`; полный путь `-TestJobFile` (скачивание по подписанной ссылке с сайта) → накладная 4/4; чужие адреса и битые ссылки — отказ до вызова модели |
| AC2 | PASS | API против dev-сервера с моком: 19/19 (строки, подпись и срок ссылки, удаление файлов, лимиты 20/60, валидация); GET-ссылка: 200/403/410/404; юнит-тесты подписи, хранилища, лимитов |
| AC3 | PASS | UI e2e Playwright 38/38: «С фото» в БЖГП, мастер-кабинете (меню, сырьё, «Добавить в журналы на дату»), скоропорте («Добавить списком», «Редактировать списки»), входном контроле; строки попадают в форму/журнал/списки; скриншоты 1440 и 390 |
| AC4 | PASS | `npm run typecheck` — exit 0; `npm test` — 2291/2291 (было 2238, +53 новых) |

Прогонов `claude -p` потрачено: 3 из 6 (модель sonnet, ~$0.015–0.02 за прогон).

---

## AC1 — воркер `dispatcher/wesetup-worker.ps1`

Тестовые картинки сгенерированы `@napi-rs/canvas` со шрифтом DejaVuSans:
[меню](evidence/ac1-menu-readable.png), [нечитаемое меню — квадраты вместо букв](evidence/ac1-menu-unreadable.png),
[накладная](evidence/ac1-invoice.png). Инструкции — ровно те, что строит сайт
(`buildVisionInstruction`): [меню](evidence/ac1-instruction-menu.txt), [сырьё](evidence/ac1-instruction-raw.txt).

1. **Читаемое меню** — `-TestImage ac1-menu-readable.png -TestPromptFile instr-menu.txt`
   ([вывод](evidence/ac1-run1-readable-menu.txt), 20 с):
   `{"items":[{"name":"Солянка сборная мясная","yield":"250/15","time":"08:40"}, … 5 из 5 блюд, выход и время точно как на картинке]}`
   — без markdown-обёртки.
2. **Нечитаемое меню** — та же инструкция ([вывод](evidence/ac1-run2-unreadable-menu.txt)): `{"items":[]}` —
   ни одной выдуманной строки.
3. **Полный путь задания** — `-TestJobFile job-ok.txt -ConfigPath cfg.json` (SiteBaseUrl=`http://localhost:3042`),
   текст задания `type: wesetup_vision_extract` / `image_url: …/api/ai/vision-image/<id>-png?exp=…&sig=…` / `---` /
   инструкция «сырьё»; воркер скачал фото с dev-сервера по подписи и вернул 4/4 позиции накладной с
   изготовителем, поставщиком из шапки, количеством и сроком в ГГГГ-ММ-ДД ([вывод](evidence/ac1-run3-jobfile-invoice.txt)).
4. **Отказы без вызова модели** ([вывод](evidence/ac1-worker-refusals.txt)): чужой хост → `image_url_refused:foreign_host`,
   чужой порт → `foreign_port`, чужой путь (`/uploads/…`) → `foreign_path`, конфиг по умолчанию
   (`https://wesetup.ru`) против `http://localhost` → `foreign_scheme`, подменённая подпись →
   `image_download_failed:http_403`, истёкшая ссылка → `http_410`.

Прочее по воркеру: файл строго ASCII (0 байт > 127), парсер PowerShell 5.1 — `PARSE OK`; существующие типы и
`Invoke-Claude` не менялись (новый путь — отдельные функции `Split-VisionJob`, `Test-VisionImageUrl`,
`Get-VisionImage`, `New-VisionMessage`, `Invoke-ClaudeStream`, `Process-VisionExtract`); скачивание без
редиректов, ≤ 6 МБ (по Content-Length и по факту чтения), только image/jpeg|png|webp по заголовку И по
сигнатуре; одно stream-json сообщение → `claude -p --input-format stream-json --output-format stream-json
--verbose --tools "" --strict-mcp-config --setting-sources= --no-session-persistence --disable-slash-commands
--model <Model>` + короткий системный промпт; ответ — событие `{"type":"result"}`. Таймаут — `TimeoutSec`,
ошибка — `/complete` с `ok:false, error:"vision:<причина>"`, логи в том же формате. Конфиг:
`dispatcher/config.json` → `"SiteBaseUrl": "https://wesetup.ru"`. Документация — `docs/ai-dispatcher.md`.

## AC2 — сайт: `POST /api/ai/vision-extract`, `GET /api/ai/vision-image/[id]`

**API против dev-сервера** (`next dev --webpack -p 3042`, `WESETUP_VISION_MOCK_FILE` с готовыми ответами,
пауза 3 с) — [19/19 PASS](evidence/ac2-api-e2e.txt):
- без входа — 401; неизвестный `kind`, без фото, 4 фото — 400; не картинка под видом JPEG — 415; > 6 МБ — 413;
- меню (2 фото) — 200, 5 строк из ответа в ```json-фенсе; **во время ожидания во временной папке лежали 2 файла,
  после ответа — 0**; запись журнала действий `ai.vision_extract` с итогом `{"result":"ok","recognized":5,"photos":2}`;
- сырьё — 4 строки с изготовителем/поставщиком/сроком; список — 2 строки;
- `/api/ocr/label` — прежний контракт `{ result: {productName, supplier, manufactureDate, …, confidence} }`;
- **лимиты**: 20 записей сотрудника за сутки → 21-е распознавание 429 «не больше 20 в сутки на сотрудника…»;
  записи старше 24 ч не считаются; 60 у организации → 429 «У организации закончились распознавания на сутки (60)…»;
  отказ по лимиту не оставляет файлов.

**Ссылка на фото** — [curl](evidence/ac2-image-link-curl.txt): действующая — `200 image/png 82780 bytes`
(ровно файл накладной), подменённая подпись — 403, истёкшая — 410, `..%2F..` — 404, без подписи — 403.

**Юнит-тесты** (`src/lib/ai-vision/*.test.ts`, [список](evidence/ac4-checks.txt)): подпись HMAC (подделка
подписи/id/срока, чужой секрет, истечение, мусор, без секрета — нельзя), временная папка (сигнатура
JPEG/PNG/WEBP, случайные имена, чужие имена не читаются, подметание старше 15 минут), лимиты 20/60,
разбор ответа (фенсы, текст вокруг, скобки в строках, битый кандидат, голый массив, заглушки, «?»,
обрезка длин, время, даты, дубли, 200 строк, «огромный мусор»), инструкция (обязательные фразы защиты
от выдумывания во всех видах, формат под вид, нет правдоподобных примеров, текст задания и отказ на
ссылку с переводом строки), мок только вне продакшена, раскладка распознанного в таблицу, уменьшение фото.

Устройство: фото → `os.tmpdir()/wesetup-vision/<32 hex>-jpg|png|webp` (без точки в URL — nginx не примет за
статику), подпись `HMAC-SHA256(VISION_IMAGE_SECRET || NEXTAUTH_SECRET, "vision-image:v1:<id>:<exp>")`, срок 15
минут; удаление в `finally` сразу после ответа + подметание забытых при каждом вызове; `enqueueAndWait` с
дедлайном 100 с; лимиты по `AuditLog` (сотрудник — индекс `[entity, entityId]`, организация —
`[organizationId, createdAt]`), плюс не чаще 6 в минуту в памяти; «не настроено» (503) / «не успели» (504) /
«не получилось» (502) — понятным текстом; логи `[ai-vision] start|done|failed|not configured|daily limit`.
Мок (`WESETUP_VISION_MOCK_REPLY` / `WESETUP_VISION_MOCK_FILE`, `…_DELAY_MS`) при `NODE_ENV=production`
игнорируется. Сессия мастер-кабинета пропущена только к `/api/ai/vision-extract`
(`master-directory-access.ts` + тест).

## AC3 — кнопка «С фото» в интерфейсе

Общий компонент `src/components/ai/recognize-from-photo.tsx`. [Прогоны Playwright — 38/38 PASS](evidence/ac3-ui-e2e.txt)
(headless Chromium, dev-сервер с моком, вход admin@haccp.local, мастер-кабинет создан через
`POST /api/settings/master-cabinet`). Скриншоты «1440» сняты при ширине окна 1440 и уменьшены до 1080 px.

| Где | Что проверено | Скриншоты |
|-----|---------------|-----------|
| БЖГП «Добавить изделия списком» (общий диалог) | кнопка; фото → «Распознаём…» → таблица 5 строк; снята галка + правка выхода → «Добавить 4 строки» → в таблице окна 4 строки, правка сохранена | [1440-01](evidence/e2e-1440-01-bjgp-dialog.png) [02](evidence/e2e-1440-02-photo-step.png) [03](evidence/e2e-1440-03-recognizing.png) [04](evidence/e2e-1440-04-review-menu.png) [05](evidence/e2e-1440-05-bjgp-filled.png), [390-01](evidence/e2e-390-01-bjgp-dialog.png) [02](evidence/e2e-390-02-photo-step.png) [03](evidence/e2e-390-03-review.png) [04](evidence/e2e-390-04-bjgp-filled.png) |
| Мастер-кабинет «Добавить в журналы на дату» (тот же диалог, с колонкой времени) | кнопка в окне | [1440-16](evidence/e2e-1440-16-master-brakerage.png) |
| Мастер-кабинет, таблица меню («Вставить списком») | 5 блюд с выходом и временем в таблице; кнопка ≥ 48 px на 390 | [1440-11](evidence/e2e-1440-11-master-menu-filled.png), [390-09](evidence/e2e-390-09-master-menu-table.png) |
| Мастер-кабинет, вкладки «Меню» и «Сырьё» (рядом с «Загрузить Excel/CSV» и «Вставить списком») | сырьё: 4 позиции → предпросмотр «Добавится 4» → «Сохранить и разослать» → в справочнике 4 позиции с поставщиком и изготовителем | [1440-12](evidence/e2e-1440-12-master-raw-panel.png) [14](evidence/e2e-1440-14-master-raw-preview.png) [15](evidence/e2e-1440-15-master-raw-saved.png), [390-08](evidence/e2e-390-08-master-menu-panel.png) [390-10](evidence/e2e-390-10-master-raw.png) |
| Скоропорт «Добавить списком» | 4 позиции сразу строками журнала (изготовитель/поставщик, кол-во, срок), сохранены на сервере; пустой результат и ошибка «не успели» | [1440-06](evidence/e2e-1440-06-perishable-dialog.png) [07](evidence/e2e-1440-07-perishable-review.png) [08](evidence/e2e-1440-08-perishable-rows.png), [390-05](evidence/e2e-390-05-perishable-dialog.png) [05b](evidence/e2e-390-05b-perishable-review.png) [06](evidence/e2e-390-06-empty.png) [07](evidence/e2e-390-07-error.png) |
| Входной контроль «Добавить несколько строк» → «С фото накладной» | 4 строки записаны в журнал (наименование, изготовитель, поставщик, «Годен до», «8 кг» в «Объём, партия, дата пр-ва») | [1440-09](evidence/e2e-1440-09-acceptance-dialog.png) [10](evidence/e2e-1440-10-acceptance-rows.png) |
| Скоропорт «Редактировать списки → Изделия» | кнопка рядом с «Добавить из файла»; 2 новые позиции → изделий 4→6, изготовителей 3→4, поставщик добавлен (сохранено в документе) | [1440-17](evidence/e2e-1440-17-perishable-lists.png) [18](evidence/e2e-1440-18-perishable-lists-added.png), [390-11](evidence/e2e-390-11-perishable-lists.png) |

390: все кнопки «С фото» и «Добавить N строк» — высота 48 px; горизонтальной прокрутки нет; на
телефоне есть «Выбрать из галереи» (pointer: coarse).

**Поиском найдены и не подключены** (другой шаблон ввода): «Справочник продуктов» (`/settings/products` —
поштучно и импорт Excel со своими полями), «Список изделий» БЖГП (по одному + «Из справочника
организации»; списком — через «Добавить изделия списком», подключено), импорт Excel в списании,
прослеживаемости, фритюре (жиры, не номенклатура), «Из справочника организации» (выбор, не ввод).
Mini App открывает те же страницы журналов, поэтому кнопка есть и там (код `src/app/mini/*` не трогался).

## AC4 — проверки

[Итог](evidence/ac4-checks.txt): `npm run typecheck` — exit 0; `npm test` — tests 2291, pass 2291, fail 0
(до задачи 2238). Pre-commit хук (секреты + typecheck + тест-гейт) пройден на коммите `b0a5917f`.
ESLint по новым файлам — без замечаний (в изменённых старых файлах только прежние предупреждения).

## Включение на проде (для оркестратора)

1. Выложить сайт (master → CI). Схема БД и зависимости не менялись.
2. Обновить `d:\www\Wesetup.ru` (воркер) до этого коммита: `dispatcher/wesetup-worker.ps1` и
   `dispatcher/config.json` с `"SiteBaseUrl": "https://wesetup.ru"`. Адрес должен совпадать (схема+хост+порт)
   с тем, откуда сайт строит ссылки: настройка `assistant_public_base_url`, иначе `NEXTAUTH_URL` прода.
3. Перезапустить wesetup-worker. До перезапуска старый воркер закрывает задание
   `wrong_worker:wesetup_vision_extract` — кнопка пишет «Не получилось распознать фото — попробуйте ещё раз
   или введите строки вручную».
4. Необязательно: `VISION_IMAGE_SECRET` в `.env` прода (иначе подпись на `NEXTAUTH_SECRET`).
5. Смоук на проде: «С фото» на реальном меню; в логах сайта `[ai-vision] start … done rows=N`, в логе воркера
   `Job …: wesetup_vision_extract` → `vision: 1 image(s)` → `Done`.

## Открытые вопросы и следующий шаг

- `/api/ai/check-photo` и `/api/ocr/reading` по-прежнему ходят в Anthropic API (ключа на проде нет) — перевести тем же
  `runVisionJob` со своей инструкцией (~30 мин каждый). `/api/ocr/label` + `PhotoCapture` переведены (контракт
  прежний, клиент теперь уменьшает фото).
- Реальный круг «сайт → очередь ProjectsFlow → воркер → сайт» не прогонялся (по условию задачи): сайт проверен
  с моком ответа, воркер — локально с реальной моделью и скачиванием с сайта.
- Лимит частоты 6/мин живёт в памяти процесса (суточные лимиты — в базе и переживают перезапуск).
- На dev-странице журналов в телефонном виде есть давнее предупреждение гидратации в шапке (`Header`,
  `src/components/layout/*` — не трогал) и предупреждения Radix «Missing Description» у старых окон журналов.

## Как повторить

Скрипты — в [e2e/](e2e/) (пути в них — абсолютные для этой машины; пароль admin берётся из `.env` копии):
`make-test-images.cjs` — картинки AC1; `gen-instructions.mts` — инструкции сайта в файлы для `-TestPromptFile`;
`gen-jobs.mts` — тексты заданий с подписанными ссылками на dev-сервер для `-TestJobFile`; `api-test.mjs` — AC2;
`ui-e2e.mjs`, `ui-e2e-mobile-master.mjs`, `ui-e2e-lists.mjs` — AC3; `vision-mock.json` — ответы мока.
Dev-сервер: `NEXT_DIST_DIR=.next-e2e NEXTAUTH_URL=http://localhost:3042 WESETUP_VISION_MOCK_FILE=<vision-mock.json>
WESETUP_VISION_MOCK_DELAY_MS=3000 node node_modules/next/dist/bin/next dev --webpack -p 3042`.
Скриншоты (`evidence/*.png`) лежат в папке задачи локально — `.gitignore` не пускает `.agent/**/*.png` в git.
