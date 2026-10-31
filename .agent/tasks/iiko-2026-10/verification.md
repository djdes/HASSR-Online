# Verification — iiko-2026-10

Свежий проход по текущему коду (дифф против `master` d13612c), проверки перезапущены.

- AC1–AC6 — **PASS** (`evidence.md`, `evidence.json`, `raw/`).
- `npm run typecheck` — exit 0; `npm run test:gate` — pass=5284, fail=0 (счётчик статических маршрутов
  150 → 151 — `/settings/integrations/iiko`); `npx eslint` — чисто; `npm run i18n:check` — 97/0.
- По коду перепроверено: сессия iiko открывается одна на всю загрузку и закрывается в `finally`
  (`raw/mock-log.txt`: каждый `auth` — с `logout`); пароль на сервер уходит только SHA1 и хранится
  зашифрованным; адрес сервера проходит `assertPublicServerUrl` и при подключении, и при каждой загрузке
  (смена DNS после подключения не откроет внутреннюю сеть); накладные — с тем же «одна накладная разными
  путями», потери — без дублей по `sourceEntryId`, справочник — только недостающие товары и заготовки.
- Ограничение: живой сервер iiko не вызывался (доступа нет) — проверено на заглушке по документированным
  методам iikoServer REST (`auth`, `logout`, `documents/export/incomingInvoice`, `v2/documents/writeoff`,
  `v2/entities/products/list`, `v2/entities/list?rootType=MeasureUnit`, `suppliers`).
- Тестовый прогон перезаписывает PDF в `.agent/tasks/english-version-1375e736/raw/` — возвращены.

Вердикт: **PASS**.
