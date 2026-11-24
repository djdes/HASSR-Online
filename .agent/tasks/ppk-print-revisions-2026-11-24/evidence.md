# Evidence: печатная ППК по структуре, подпись пальцем, редакции «ППК NNN» (ppk-print-revisions-2026-11-24)

Спека: `spec.md` (frozen 2026-11-24).

## Что сделано

| Часть | Файлы |
|---|---|
| Реестр редакций: таблица, правила, утверждение со следующим номером | `prisma/schema.prisma` (`PpkRevision`), `src/lib/ppk/revisions.ts`, `revisions.server.ts`, `api/production-control/revisions` |
| Плашка редакции и вопрос «Утвердить редакцию» (с номером), повторный вопрос после правки | `src/components/production-control/revision-control.tsx` |
| Редакции у пунктов 1.8, 1.9, 2.2, 2.3, 2.9, прил. 3 и 2.1 | `structure/panels/text-panel.tsx`, `policy-panel.tsx`, `policy-client.tsx` (событие после сохранения) |
| Документы текстом, правка, замена файла; прил. 5 и 6 | `src/lib/ppk/text-docs.ts`, `text-docs.server.ts`, `api/production-control/text-docs`, `text-doc-dialog.tsx`, `ppk-docs-list.tsx`, `source-panels.tsx` |
| База знаний `/knowledge`: номер редакции, «Создать текстом», правка, замена | `knowledge-documents-client.tsx`, `knowledge/page.tsx`, предпросмотр `.txt` |
| Реестр редакций — страница и ссылка с обзора | `production-control/revisions/page.tsx`, `production-control/page.tsx` |
| Подпись пальцем: поле, API, отметка сотрудника, лист 3.7 | `signature-pad.tsx`, `src/lib/ppk/signature.ts`, `api/production-control/acknowledgements/sign`, `api/acknowledgements` (подпись), `pin` (способ), `ack-pin-sign.tsx`, `acknowledge-button.tsx`, `acquaintance-panel.tsx`, `acknowledge.server.ts` |
| Печатная ППК по структуре | `src/lib/ppk/structure-print.server.ts` (данные), `structure-pdf.ts` (jsPDF + pdf-lib), `structure-titles.ts`; общие помощники — `pdf.ts` |
| Новый PDF во всех местах | `api/production-control/program/pdf`, `api/inspector/[token]/production-control/[doc]`, `api/acknowledgements/ppk/file`, `api/reports/compliance-bundle` |
| Тексты ru/en/uz | `productionControl.revisions`, `textDocs`, `signature`, `structure.text`, `structure.acquaintance`, `acknowledge`, `knowledgeUi` |

## Проверки

См. таблицу результатов ниже (заполняется по факту прогонов).

| Проверка | Результат |
|---|---|
| `npm run typecheck` | 0 ошибок (`raw/typecheck.txt`). По ходу: полная проверка падала с `RangeError: Map maximum size exceeded` из-за типа `ReturnType<typeof useTranslations>` без пространства имён — убран; 3 ошибки `Bytes` (Prisma 7 ждёт `Uint8Array<ArrayBuffer>`) — исправлены |
| `npx eslint` 44 изменённых файла (.ts/.tsx) | 0 ошибок, 0 предупреждений (`raw/eslint.txt`) |
| Юнит-тесты `src/lib/ppk/*.test.ts` + `pdf`, `route-slug-collisions`, `borderless`, `neutral-palette` | 236/236; новые: `revisions.test.ts` (9), `structure-pdf.test.ts` (6), `signature.test.ts` (4) |
| `npm run i18n:check` | 103/103 |
| `npm run build` | успешно (дважды: до и после исправления границ сообщений) |
| Полный набор тестов `TEST_FULL=1 bash scripts/test-with-baseline.sh` (схема изменилась) | `pass=7474, fail=0` (`raw/full-tests.txt`) |
| Стенд (next start + Postgres 16, демо-организация, чистая база) | `raw/e2e-b-output.txt`: 46/46 |
| Снимки (локально, `.agent/**/*.png` в `.gitignore`) | `raw/screens/`: редакция утверждена, повторный вопрос, прил. 6, реестр, `/knowledge`, подпись пальцем, лист 3.7, страница ознакомления |

### Что показал стенд (первый прогон 41/43 → исправлено)

- `/knowledge` и `/acknowledge/<doc>` показывали ключи вместо текстов: клиентские тексты этих страниц не получали `productionControl` (а `/acknowledge` — и `acknowledge`: кнопка «Ознакомлен» показывала `acknowledge.button` ещё на master). Добавлены границы сообщений: `knowledge/layout.tsx`, новый `acknowledge/layout.tsx`.
- Ожидание сценария «со сканом страниц больше на 2» было неверным: скан заменяет текст политики (правило документа владельца). Проверка заменена на «2 страницы скана под колонтитулом документа».

## Критерии приёмки

| AC | Статус | Доказательство |
|---|---|---|
| AC1 | PASS | `revisions.test.ts`; стенд: ППК 001 → повтор без изменений — та же; пробелы — без изменений; слово → «изменён», ППК 002; реестр `ППК 004:-, ППК 003:ППК 004, ППК 002:-, ППК 001:ППК 002`; номер — `@@unique([organizationId, number])` + повтор при P2002 |
| AC2 | PASS | стенд: плашка 1.9, вопрос с номером, сам вопрос «Документ изменён» после сохранения; прил. 6 — вопрос после правки; страница реестра — 4 строки; `/knowledge` — номер редакции |
| AC3 | PASS | стенд: инструкция и процедура текстом, правка текста, замена файла → «изменён», текст у файла — 400, без названия — 400 |
| AC4 | PASS | `structure-pdf.test.ts` (все 32 пункта по порядку, колонтитулы, страницы содержания); стенд: «Содержание», разделы, «Стр. 2 из N» … «Стр. N из N» |
| AC5 | PASS | тесты: скан PDF 2 стр. + картинка → 3 страницы-рамки, битый — строкой, пустая страница скана не ломает сборку; стенд: 2 страницы скана политики под колонтитулом |
| AC6 | PASS | тест: колонтитул страниц скана — «ППК 004 от 24.11.2026», неутверждённой — «Редакция не утверждена»; стенд: ППК 002 и ППК 004 в PDF |
| AC7 | PASS | стенд: подпись пальцем на устройстве руководителя → «подпись пальцем» в листе, не PNG → 400; поле подписи на странице сотрудника; `signature.test.ts`; лист 3.7 в PDF с картинкой (тест) |
| AC8 | PASS | маршруты переведены на `buildPpkStructurePdf`; стенд: PDF программы и файл для сотрудника; схема — новая таблица и три необязательные колонки (`scripts/lib/schema-safety.cjs` пропускает только такие) |
| AC9 | PASS | стенд: повар → 403 на реестр, утверждение, документ текстом, подпись; без входа → 401; несуществующий документ → 404; ключи текстов — только своей точки (`resolveRevisionDocs`) |
| AC10 | PASS (стенд) | все проверки выше; выкладка — после слияния |

## Принятые ограничения

- Отметки ознакомления по-прежнему на уровне организации (как в прошлой задаче).
- Подпись пальцем — только для листа ознакомления с Программой (3.7), как в документе владельца; остальные документы — прежняя кнопка.
- Файлы сверх 80 МБ / 300 страниц сканов печатаются строкой «приложен в электронном виде».
