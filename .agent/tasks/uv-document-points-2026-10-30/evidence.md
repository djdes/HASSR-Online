# Доказательства — УФ-лампы по точкам (2026-10-30)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `src/lib/uv-document-points.ts` `uvDocumentPointFixes`; `src/lib/uv-document-points.test.ts` (6 тестов) |
| AC2 | PASS | `src/app/(dashboard)/journals/[code]/page.tsx` — `syncUvDocumentPoints` перед выборкой документов УФ |
| AC3 | PASS | `src/app/api/cron/uv-lamp-running/route.ts` — `syncAllUvDocumentPoints`, `movedDocuments` в ответе |
| AC4 | PASS | `src/lib/uv-lamp-runs.ts` `ensureUvDocumentForLamp`: `placeOnLampPoint`, выбор документа точки лампы, «по номеру» без чужой точки; e2e: «QR: документ получил точку лампы» |
| AC5 | PASS | `journal-structure-carry.ts` `foreignEquipmentIds`; `journal-auto-create.ts` `loadCarriedStructure`; тест «лампа чужой точки или общего цеха…» |
| AC6 | PASS | `api/equipment/[id]` (смена цеха), `api/areas/[id]` (смена точки цеха); e2e: «лампа перенесена: активный d1 → Одинцовская» |
| AC7 | PASS | `uv-lamp-runtime-documents-client.tsx` — `SharedDocumentBadge` |
| AC8 | PASS | `whats-new-notes.ts` + иконка категории; typecheck; тесты; `raw/verify-sync.out.txt` — ALL PASS (15) на e2e-БД |

e2e-БД: `localhost:5432/wesetup_e2e` (скрипт отказывается работать с другой БД),
фикстура создаётся и удаляется в `finally`. Прод-БД не читалась и не менялась
вручную: документы на проде переедут сами при открытии журнала, при скане QR
лампы и часовым кроном.
