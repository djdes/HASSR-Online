# Доказательства — поставки по точкам (2026-11-01)

| AC | Статус | Где |
|---|---|---|
| AC1 | PASS | `prisma/schema.prisma`: `SupplyDocument.buildingId`, `LossRecord.buildingId`, `LabelPrint.buildingId` (`onDelete: SetNull`), `SupplyConnection.storePoints`, обратные связи у `Building`; `prisma db push` на e2e-базе прошёл |
| AC2 | PASS | `upd.ts`: `consignee` из `ГрузПолуч`; `supply-points.ts` `pointByKpp`; `documents.server.ts` `supplyPointByKpp`; тесты «точка по КПП…», `upd.test.ts`; e2e: `raw/http-check.txt` — накладная с грузополучателем точки А получила точку А |
| AC3 | PASS | `edo/[id]/acceptance-form.tsx`: блок «Точка приёмки», без выбора — подсказка и прокрутка к блоку; `edo/[id]/page.tsx`: по умолчанию точка накладной, иначе точка из шапки; e2e: блок на странице |
| AC4 | PASS | `api/edo/documents/[id]/accept`: `resolveAcceptancePoint` (тест), накладная другой точки — 404; e2e: без точки — 400 `point_required`, чужая точка — 403 `point_forbidden`, своя — 200; `raw/inspect.ts`: накладная и журнал приёмки — точки А |
| AC5 | PASS | `edo/page.tsx`: `access.listWhere`, пометка точки; `edo/[id]/page.tsx`: накладная читается с `access.seeWhere`; тест «входящие по точкам…»; e2e: точка А — своя и без точки, без точки Б; «Вся организация» — все с пометкой; накладная точки Б — «не найдено», её данных в ответе нет |
| AC6 | PASS | `iiko.ts`: `storeId` у накладной (`defaultStore`, иначе склад строки) и акта, `parseCorporateItems`, `stores()` / `departments()`; тесты в `iiko.test.ts` |
| AC7 | PASS | `api/settings/supply/[provider]/stores` (GET — склады с сервера, PUT — сопоставление, только точки организации или «не загружать»); `iiko-stores-card.tsx` на странице настроек iiko; e2e: чужая точка — 400, сохранение — 200, карточка на странице |
| AC8 | PASS | `sync.ts` `storeDecision`, `sync.server.ts` — `iikoStoreDecision` + `LossRecord.buildingId`; тест «iiko sync по складам…» |
| AC9 | PASS | `api/setup-helper/sync` — `buildingId` этикетки по `userBuildingTargets`; `print-agent/labels` — фильтр по точке; e2e: точка А — её и общая этикетка, без точки Б |
| AC10 | PASS | Общее правило `lossPointWhere` в `src/lib/point-filters.ts` (из #81) расширено: `buildingId` точки, иначе цех точки или общий, иначе без места (тест в `point-filters.test.ts`); `/losses` и `GET /api/losses` — одно правило; `POST /api/losses` — точка цеха или из шапки; e2e: точка А — её и без места, «Вся организация» — все |
| AC11 | PASS | после rebase на `origin/master` 01e94da0: `npm run typecheck` — 0 ошибок; `npm run i18n:check` — 97/97; тесты `src/lib/supply/*.test.ts` + `point-filters` + `audit-labels`; eslint изменённых файлов — 0 ошибок; e2e — `raw/http-check.txt` 24/24 (21 HTTP + 3 из БД) |

Тест `message-contract.test.ts` при прямом запуске в этой копии на Windows падает на `confirm/ru is stale`: git отдаёт файлы с CRLF, генератор пишет LF. Содержимое не менялось (`git diff --ignore-cr-at-eol` пусто), `npm run i18n:check` — зелёный.

## Проверка на e2e-базе (не прод)

- `raw/fixture.ts` → `raw/fixture.json`: накладная по КПП, без точки, точки Б; этикетки и потери трёх видов; руководитель точки А; подключение iiko без ключей.
- `raw/http-check.mjs` (dev на 3024) → `raw/http-check.txt`; `raw/inspect.ts` дописывает сверку БД.
- Код ответа «не найдено» для страницы накладной другой точки — 200: Next отдаёт `notFound()` потоком. Проверяется содержимое: маркер 404, данных накладной нет. Накладная другой точки не читается из БД вовсе (условие точки в запросе) — иначе дев-сервер React кладёт прочитанные данные в отладочную запись страницы.

## Не входит / замечания

- `EdoCabinet` / `EdoDocument` — исходящие документы платформы клиентам (договоры, счета, УПД от ООО «БФС»), к торговым точкам не относятся.
- Номенклатура iiko — общая на организацию (`Product` без точки).
- Меркурий: документы уже по точкам через площадки (`MercuryEnterprise.buildingId`). Но `GET /api/mercury/documents` берёт `getActiveBuildingId`: в режиме «Вся организация» — офис или первая точка, то есть видны только её документы и общие. Отдельная мелкая правка.
- Одно подключение iiko на организацию (`@@unique([organizationId, provider])`): если у точек разные серверы iiko, нужна отдельная задача.
