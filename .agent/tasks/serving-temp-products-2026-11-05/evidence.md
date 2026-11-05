# Evidence — serving-temp-products-2026-11-05

Проверено 05.11.2026 на локальной копии базы `wesetup_serving` (не прод), dev-сервер рабочей копии `--webpack`.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `prisma/schema.prisma`: `kind @default("raw")`, `storageConditions`, `shelfLifeHours`, `servingTemp`; `db push` на копии — 5 старых продуктов получили `raw` |
| AC2 | PASS | `raw/desktop-products-all.png`, `raw/*-products-finished.png` (вкладка — 4 строки), `raw/*-product-dialog-*.png`; правка «Котлета» → в базе `shelfLifeHours=4, servingTemp=hot` (PUT 200) |
| AC3 | PASS | `src/app/api/products/import/route.ts` + `src/lib/product-kinds.test.ts` (вид, «12 ч», «3 сут», режим/условие) |
| AC4 | PASS | `src/lib/serving-temperature-checklist.test.ts`: шаблон не разворачивается, `rows: []` — подсказка, СанПиН-снимок без изменений |
| AC5 | PASS | тот же тест + `typical-checklists.test.ts` (7 шаблонов, 6 статичных) |
| AC6 | PASS | `check.mjs`: блюда «Борщ, Котлета, Пюре (бракераж сегодня) + Компот, Салат (справочник)», вчерашний плов не попал; подача предзаполнена у 4 из 5; `refresh-check.mjs`: устаревший updatedAt → 409, новое блюдо бракеража добавлено в конец, введённые 80 °C сохранились, повтор — 0 новых |
| AC7 | PASS | `raw/desktop-inspection-out-of-norm.png` — 68 °C при норме ≥75 подсвечено, требуется комментарий |
| AC8 | PASS | тест «PDF проверки»: карточка блюда, «58 °C», нарушение; PDF собирается из развёрнутых вопросов |
| AC9 | PASS | `npm run -s typecheck` — exit 0; тесты чек-листов/справочника/i18n — зелёные, кроме `message-contract` (CRLF/LF окружения Windows); 390 px — без горизонтальной прокрутки |
