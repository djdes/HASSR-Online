# Evidence — journal-sets-checklists-2026-10

Ветка `feat/journal-sets`, worktree `D:/wt/journal-sets`, база `wesetup_e2e` (локальная, 127.0.0.1:5432),
dev-сервер `http://localhost:3031` (обслуживает этот worktree: его лог пишется в `raw/dev-server.log`).
Прогон проверок — 17–18.10.2026, после продолжения работы прерванного агента.

## Итог по критериям

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `src/lib/journal-sets.ts`; `journal-sets.test.ts` — 6 тестов зелёные (`raw/targeted-tests.txt`): коды в каталоге, 11 пунктов эскиза по порядку, ХАССП = 19 (18 + `ccp_monitoring`), `extra` = остаток, пересечение только `climate_control`/`cold_equipment_control`, объединение = каталог (46). |
| AC2 | PASS | `src/app/api/settings/journals/sets/route.ts`; `raw/api-check-results.json` — 401 без входа, 403 повару (GET и POST), 400 на `extra` и `all`, POST `haccp` → `changed` из 17 кодов, повтор → `changed: []`; `raw/db-audit-log.json` — 17 записей `journal.enable` с `via: "journal-set"`, `journalSet: "haccp"`, от руководителя; повторные вызовы записей не дали. `health_check` набором не включается (связанный пункт, `enabled: false` в GET). |
| AC3 | PASS | `ccp_monitoring` в конце `ACTIVE_JOURNAL_CATALOG` и в `ALL_JOURNAL_CODES`; сид: `raw/seed-0..3-*.json` + `raw/seed-run-1.log`/`seed-run-2.log` — шаблон выключен → 1-й прогон «Впервые включаем ccp_monitoring: … 1 из 5» (у всех 5 организаций код в выключенных, шаблон активен) → человек включил журнал в ресторане → 2-й прогон ничего не пишет и включённое не трогает. Форма/запись/PDF: `raw/ccp-readiness-results.json` (поля формы, 2 записи через `/api/journals`, страница записи, PDF записей 160 КБ, образец бланка, ППК «ККТ»). Новые организации: `raw/db-new-org-defaults.json` — у ресторана и производства `ccp_monitoring` выключен (у производства — в рекомендуемых). Тесты полноты каталога/гидов/переводов зелёные. |
| AC4 | PASS | `TRAINING_TOPICS` с `description` у всех тем, тема `haccp` «Принципы ХАССП»; переводы ru/en/uz `options.staffTraining.topics.haccp`, контракт обновлён; `staff-training-document.test.ts` зелёный; текст подсказки на десктопе и телефоне — `raw/training-topic-hint.json` (скриншоты `raw/training-topic-hint-{desktop,mobile}.png` лежат локально: `.gitignore` исключает `.agent/**/*.png`). |
| AC5 | PASS | `FOOD_SERVICE_SPHERES` + `defaultEnabledCodesFor` в `sphere-journal-rules.ts`; `sphere-journal-rules.test.ts` зелёный; на базе через настоящий `createOrganization` (`raw/db-new-org-defaults.json`): «Ресторан» — все 11 стандартных включены, `health_check` выключен; «Производство» — прежний обязательный минимум (6). Миграции существующих организаций нет. |
| AC6 | PASS | `src/lib/compliance-standard-set.ts` (чистая функция) + `compliance-standard-set.test.ts`; вес 10 прежний, балл = включено/11; на базе (`raw/ccp-readiness-results.json`): «Включены все 11…» → выключили медкнижки и инструктажи → «Включено 9 из 11 … Не включены: «Медицинские книжки», «Журнал регистрации инструктажей…»» → «Включить весь набор» вернул ровно эти 2 → снова 11 из 11. |
| AC7 | PASS | `src/lib/checklist-templates/*` — 6 шаблонов (вопросов 51/50/49/45/45/43, разделов 5–9, критичных 5–8, типы: да/нет, число, выбор, мультивыбор, шкала, текст, фото, подпись, дата); `typical-checklists.test.ts` зелёный; `raw/api-check-results.json` — GET 6 шаблонов, 403 повару на POST, 400 на неизвестный ключ, 6 × 201, повтор → 200 `created: false` с тем же id, копии в `ChecklistTemplate`, PDF и проверка создаются по каждой копии. |
| AC8 | PASS | tsc exit 0; eslint по 40 изменённым файлам — 0 новых проблем (те же 8 ошибок сгенерированного `message-contract.d.ts` и 8 предупреждений, что на HEAD); полный прогон 4092 / pass 4088 / fail 0 / skipped 4 (база: 4064 / fail 1 — CRLF-тест); API на `wesetup_e2e` — 38 + 22 проверок PASS. |
| AC9 | PASS | `git status`: нет новых `page.tsx`, нет правок `src/lib/app-nav.ts` и `src/components/layout/*`; коммит в `feat/journal-sets`, без пуша. |

## AC8. Проверки

- `npx tsc --noEmit --skipLibCheck` — exit 0 (`raw/tsc.txt`). Первый прогон упал на `src/lib/robokassa.ts`
  («File appears to be binary») — порча диска, не наша правка; после восстановления — 0 ошибок.
- `npx eslint <40 изменённых/новых файлов src и prisma>` — 8 errors / 8 warnings (`raw/eslint.txt`), все уже есть
  на HEAD: прогон базовых версий через `--stdin` дал те же 8 errors (`message-contract.d.ts`, генерируется
  `scripts/i18n-types.mjs`), 7 warnings `document-pdf.ts`, 1 warning `staff-training-document-client.tsx`.
- Тесты затронутых модулей — 69 / 69 (`raw/targeted-tests.txt`).
- Полный прогон `node --import tsx --test "src/**/*.test.ts"` — tests 4092, pass 4088, fail 0, skipped 4
  (`raw/full-tests.tap` не коммитится — 1 МБ; список падений `raw/full-fails.txt` пуст). База на b91388b0:
  tests 4064, fail 1 — «message argument types are generated…» (CRLF, лечится `node scripts/i18n-types.mjs`).
- `node scripts/i18n-types.mjs --check` — exit 0.
- API на `wesetup_e2e`: `e2e/api-check.mjs` — 38 PASS; `e2e/ccp-readiness-check.mjs` — 22 PASS;
  `e2e/audit-check.ts`, `e2e/seed-check.ts`, `e2e/check-defaults.ts`, `e2e/training-topic-shot.mjs` — см. AC2–AC5.

## Решения по ходу (этой сессии)

- **`changed` вместо `enabled` в ответе POST наборов** — так в spec («повторный вызов → `changed: []`»).
  Скрипты `e2e/api-check.mjs` и `e2e/ccp-readiness-check.mjs` обновлены.
- **Описание темы «ККТ» исправлено.** Прошлый агент описал её как «контрольно-кассовую технику»; в проекте
  это критические контрольные точки (перевод en — «CCP»). Новое описание — про ККТ на участке сотрудника
  и запись измерений в журнал мониторинга ККТ.
- **`src/lib/whats-new-notes.ts` откатан** к HEAD — по указанию текст «Что нового» добавят при сведении веток.
- **`FOOD_SERVICE_SPHERES`** (решение прошлого агента, проверено): ресторан, кафе, бар, столовая, фастфуд,
  пекарня, кейтеринг, отель, АЗС, школа/детсад, медицина. Отель и АЗС в базовом коде описаны как «обычный
  общепит по СанПиН», школа и медицина — питание в детских/медицинских организациях. Не входят: производство
  (свой набор по ХАССП), магазин, фитнес, салоны, «Другое».
- **Пороги «Готовности»**: 0 пропусков — «ок», 1–3 — «внимание», больше — «провал»; балл пропорционален.
- **`document-pdf.ts`**: константа `CCP_MONITORING_PDF_TITLE` стояла между `import` — перенесена под блок импортов.
- **Диск D:** во время работы испортились 7 чужих неизменённых файлов (`robokassa.ts` и др.) — восстановлены
  `verify-worktree.cjs --restore`.

## Сырые артефакты

`raw/api-check-results.json`, `raw/api-sets-*.json`, `raw/api-typical-get-initial.json`, `raw/db-audit-log.json`,
`raw/ccp-readiness-results.json`, `raw/ccp-entries-report.pdf`, `raw/db-new-org-defaults.json`, `raw/seed-*.json`,
`raw/seed-run-*.log`, `raw/training-topic-hint.json`, `raw/targeted-tests.txt`, `raw/tsc.txt`,
`raw/eslint.txt`, `raw/full-fails.txt`, `raw/baseline-fails.txt`, `raw/typical-checklists-stats.txt`.
Скрипты — `e2e/` (setup.ts, check-defaults.ts, api-check.mjs, audit-check.ts, ccp-readiness-check.mjs,
seed-check.ts, training-topic-shot.mjs).

## Ждёт решения человека

- По spec в master не выкладываем: меняются регистрация (новый общепит получает 11 журналов стандартного
  набора вместо 4) и «Готовность» (считается по 11 журналам набора, а не по всему каталогу). Нужен просмотр
  владельцем перед сведением веток.
- Кнопки «Включить весь набор» и «Добавить типовой шаблон» в интерфейсе — следующая задача (API готов).
- Тексты 6 типовых чек-листов написаны по открытым нормам (СанПиН 2.3/2.4.4282-26, ТР ТС 021/2011,
  ГОСТ Р 51705.1); содержательная вычитка технологом не проводилась.
