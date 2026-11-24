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

## Проверки

(заполняется по результатам команд ниже)
