# Evidence: структура ППК на `/production-control` (ppk-structure-2026-11-24)

Спека: `spec.md` (frozen 2026-11-24). Исходный документ владельца — `raw/source.md`.

## Что сделано

| Часть | Файлы |
|---|---|
| Реестр пунктов (32 пункта, 4 раздела, номера как в документе) | `src/lib/ppk/structure.ts` |
| Статусы и прогресс пунктов | `src/lib/ppk/structure-status.ts`, факты — `structure-facts.server.ts` |
| Обязательные поля 1.1 и 1.4, предупреждение о пропусках | `src/lib/ppk/structure-fields.ts` |
| Шаблоны 1.8, 2.2, 2.3, 2.9 и типовые строки 3.1–3.4 | `src/lib/ppk/structure-templates.ts`, колонки — `prp-tables.ts` |
| Новые блоки записей (org-chart, contracts, production-info, text-*, prp-*) и папки | `src/lib/ppk/records.ts`, `folders.ts` |
| Ссылка пункта = адрес `/production-control/item/<id>`; с обзора — окно (`@modal/(.)item/[id]`), напрямую — страница | `src/app/(dashboard)/production-control/@modal/**`, `item/[id]/page.tsx`, `layout.tsx` |
| Окно — стандартный `Dialog` (ПК — по центру, телефон — шторка) | `src/components/production-control/structure/item-dialog.tsx` |
| Панели 32 пунктов | `src/components/production-control/structure/panels/*` |
| Обзор: структура со ссылками и статусами, прогресс по пунктам, «Следующий пункт» | `src/app/(dashboard)/production-control/page.tsx`, `structure-outline.tsx`, `next-item.tsx` |
| Оргструктура: конструктор схем, «Собрать из должностей», печать | `src/lib/ppk/org-chart.ts`, `api/production-control/org-chart`, `production-control/org-chart/[id]` |
| «Загрузить из справочника» (1.5) | `src/lib/ppk/product-import.ts`, `api/production-control/products/import` |
| «Заполнить типовыми» (3.1–3.4) | `api/production-control/prp/fill` |
| Лист ознакомления (3.7): документ «ppk», PIN-подпись | `src/lib/ppk/acknowledge*.ts`, `api/production-control/acknowledgements/pin`, `acknowledge/[docKey]/page.tsx` |
| Договоры «видно проверяющему» на портале | `src/lib/inspection-norms*.ts`, `components/inspector/portal-sections.tsx` |
| Программа (страница и PDF) берёт свои аварийные ситуации 3.3 | `assemble.server.ts`, `pdf.ts`, `program/page.tsx` |
| Оболочка не «прыгает» под окном (вкладки, «‹ назад», проявление страницы) | `src/lib/route-overlay.ts`, `section-tabs.tsx`, `motion-runtime.tsx` |
| Тексты ru/en/uz | `src/i18n/messages/{ru,en,uz}.json` (`productionControl.structure`, `orgCharts`, …) |

## Проверки (команды и результаты)

| Проверка | Результат |
|---|---|
| `npm run typecheck` | 0 ошибок (см. `raw/typecheck.txt`) |
| `npx eslint <83 изменённых файла>` | 0 ошибок, 1 старое предупреждение (`program/page.tsx:33`, не из задачи) |
| `node --import tsx --test src/lib/ppk/*.test.ts src/lib/route-overlay.test.ts src/app/route-slug-collisions.test.ts src/app/motion.test.ts src/lib/inspection-norms*.test.ts` | 233/233; новые: `structure.test.ts` (13), `structure-status.test.ts` (12), `org-chart.test.ts` (3), `route-overlay.test.ts` (1) |
| Хук pre-commit (полный прогон, 87 связанных файлов → эскалация) | `pass=7442, fail=0` |
| `npm run i18n:check` | 103/103 |
| `npm run build` (next build --webpack) | успешно; первая сборка поймала коллизию `@modal/[...catchAll]` ↔ `[...missing]` — исправлено переименованием |
| Браузер, локальный стенд (`next start` + Postgres 16, демо-организация) | `raw/e2e-browser-results.json`: 46/46 — 32 окна без ошибок, адрес окна, Esc, прямой заход, сохранение 1.9, «Заполнить типовыми» 3.1, статусы обзора, телефон 390px (шторка 390×820 снизу, без горизонтальной прокрутки), нет ошибок страницы |
| Действия через API на стенде | `raw/e2e-api-output.txt`: 19/19 — PIN (без версии 404, неверный 401 с остатком попыток, верный — отметка), «Собрать из должностей» + редактор и печать, «Загрузить из справочника» (2 из 3, без дублей), договор и битый договор (400), одиночный блок (409), 3.3 в программе и PDF, страница ознакомления |
| Права | `raw/e2e-rights-output.txt`: повар — страница пункта уводит в `/mini/today`, все 6 новых/изменённых API → 403 |
| Снимки (локально: `.agent/**/*.png` в `.gitignore`) | `raw/screens/`: обзор (ПК), окна 1.1, 1.4, 3.3, 3.7, страница пункта 1.9, обзор и шторка на телефоне, тёмная тема (2.8), редактор оргструктуры |

## Критерии приёмки

| AC | Статус | Доказательство |
|---|---|---|
| AC1 | PASS | `01-overview-desktop.png`; e2e: 32 ссылки `/production-control/item/<id>`, 4 раздела; прогресс «Заполнено N из 32 пунктов»; документы, мастер и «Заказать индивидуально» на месте |
| AC2 | PASS | e2e: клик → адрес окна, обзор под окном, окно 912px по центру; Esc → обзор; телефон — шторка во всю ширину снизу; прямой заход — страница (`04-item-page-1-9.png`) |
| AC3 | PASS | e2e: все 32 окна; сохранение 1.9; 3.1 типовые; API: 1.2, 1.3, 1.4, 1.5, 3.3, 3.7 |
| AC4 | PASS | новые данные — новые блоки; существующие блоки/папки показываются в пунктах (2.2/2.4 — `team-signed`, 1.3 — договоры лаборатории и дезслужбы); удалений нет; страницы блоков не менялись (кроме общих компонентов схем — вид `org-chart`) |
| AC5 | PASS | `02-dialog-1-1-desktop.png`, `03-dialog-1-4-desktop.png`: плашка «Ваши документы могут быть заполнены не полностью, не хватает сведений» со списком; сохранение с пропуском — через подтверждение |
| AC6 | PASS | схемы zod (тесты), битый договор → 400, вторая запись `production-info` → 409; копия ППК на точку копирует все блоки обобщённо (`scope.server.ts`) |
| AC7 | PASS | `e2e-api-output.txt` |
| AC8 | PASS | `e2e-rights-output.txt` |
| AC9 | PASS | typecheck, eslint, тесты, i18n:check, build — см. таблицу выше |
| AC10 | см. `verdict.json` | стенд проверен; выкладка — после слияния в master |
