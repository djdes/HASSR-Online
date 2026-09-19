import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceRowToBatchDraft,
  canCreateBatchFromAcceptanceRow,
  createAcceptanceRow,
  getAcceptanceDocumentDefaultConfig,
  getIncomingControlRowValues,
  normalizeAcceptanceDocumentConfig,
  parseAcceptanceQuantity,
} from "@/lib/acceptance-document";

test("ответственный за приёмку по умолчанию — по правилам ростера, не аккаунт-почта", () => {
  const owner = { id: "owner", name: "boss@mail.ru", role: "owner" };
  const manager = { id: "mgr", name: "Анна Управляющая", role: "manager" };
  const cook = { id: "cook", name: "Борис Повар", role: "cook" };
  assert.equal(getAcceptanceDocumentDefaultConfig([owner, manager, cook]).defaultResponsibleUserId, "cook");
  assert.equal(getAcceptanceDocumentDefaultConfig([owner, manager]).defaultResponsibleUserId, "mgr");
  assert.equal(getAcceptanceDocumentDefaultConfig([]).defaultResponsibleUserId, null);
});

/**
 * Журнал `incoming_control` перестроен на таблицу эталона (11 колонок).
 * Старые записи писались по таблице контроля СЫРЬЯ — они обязаны читаться
 * в новой сетке без миграций. Эти тесты фиксируют маппинг.
 */

test("legacy acceptance row maps into the 11-column incoming_control grid", () => {
  const row = createAcceptanceRow({
    deliveryDate: "2026-04-11",
    productName: "Гастрономия",
    manufacturer: 'ООО "Агро-Юг"',
    supplier: 'ООО "Метро"',
    transportCondition: "satisfactory",
    packagingCompliance: "non_compliant",
    organolepticResult: "satisfactory",
    expiryDate: "2026-04-18",
    note: "Возврат по акту №12",
  });

  // «Годен до» подхватывает предельный срок реализации.
  assert.equal(row.shelfLifeDate, "2026-04-18");
  // Производитель и поставщик схлопываются в одну колонку.
  assert.equal(row.manufacturerSupplier, 'ООО "Агро-Юг" / ООО "Метро"');
  // Органолептика / транспортировка / упаковка уходят в «Соответствие
  // товара сопроводительной документации».
  assert.match(row.documentCompliance, /Упаковка, маркировка, документы: Не соотв\./);
  assert.match(row.documentCompliance, /Транспортировка: Удовл\./);
  assert.match(row.documentCompliance, /Органолептика: Удовл\./);
  // Примечание становится корректирующим действием.
  assert.equal(row.correctiveActions, "Возврат по акту №12");
  // Несоответствие упаковки ⇒ «О» (Отклонить).
  assert.equal(row.acceptanceDecision, "reject");
  assert.equal(getIncomingControlRowValues(row).acceptanceDecision, "О");
});

test("legacy row without defects is read as accepted", () => {
  const row = createAcceptanceRow({
    productName: "Молочная продукция",
    transportCondition: "satisfactory",
    packagingCompliance: "compliant",
    organolepticResult: "satisfactory",
  });
  assert.equal(row.acceptanceDecision, "accept");
  assert.equal(getIncomingControlRowValues(row).acceptanceDecision, "П");
});

test("v2 row keeps its own values and never re-derives from legacy defaults", () => {
  const stored = createAcceptanceRow({
    deliveryDate: "2026-08-10",
    productName: "Мука в/с",
    shelfLifeDate: "2026-12-01",
    manufacturerSupplier: 'ООО "Мельком"',
    accompanyingDocs: "ТТН №1245",
    batchInfo: "20 кг, партия 45-А",
    productTemperature: "+2 °C",
    documentCompliance: "",
    acceptanceDecision: "accept",
    correctiveActions: "",
  });

  // Пустые v2-поля остаются пустыми — свод legacy-оценок не подставляется.
  assert.equal(stored.documentCompliance, "");
  assert.equal(stored.correctiveActions, "");
  // Round-trip через JSON (как в БД) ничего не ломает.
  const roundTripped = createAcceptanceRow(JSON.parse(JSON.stringify(stored)));
  assert.equal(roundTripped.documentCompliance, "");
  assert.equal(roundTripped.acceptanceDecision, "accept");
  assert.equal(roundTripped.shelfLifeDate, "2026-12-01");
  // Зеркало в legacy-поле — чтобы cron сроков годности видел дату.
  assert.equal(roundTripped.expiryDate, "2026-12-01");
  assert.equal(roundTripped.manufacturerSupplier, 'ООО "Мельком"');
});

test("normalizeAcceptanceDocumentConfig migrates rows stored in the old schema", () => {
  const config = normalizeAcceptanceDocumentConfig({
    rows: [
      {
        id: "row-1",
        dateSupply: "2026-03-01",
        productName: "Сыр",
        manufacturer: "Молзавод",
        supplier: "",
        decision: "reject",
        correctiveAction: "Отклонено, возврат",
        expiryDate: "2026-03-10",
      },
    ],
  });

  assert.equal(config.rows.length, 1);
  const values = getIncomingControlRowValues(config.rows[0]);
  assert.equal(values.deliveryDate, "01-03-2026");
  assert.equal(values.shelfLifeDate, "10-03-2026");
  assert.equal(values.manufacturerSupplier, "Молзавод");
  assert.equal(values.acceptanceDecision, "О");
  assert.equal(values.correctiveActions, "Отклонено, возврат");
});

test("строка приёмки → черновик партии: продукт, поставщик, количество, даты", () => {
  const row = createAcceptanceRow({
    deliveryDate: "2026-09-10",
    productName: "Молоко 3,2 %",
    manufacturerSupplier: "Молзавод / ООО «Поставка»",
    shelfLifeDate: "2026-09-17",
    batchInfo: "120 кг, партия 77, 08.09.2026",
    accompanyingDocs: "ТТН 451",
  });
  const draft = acceptanceRowToBatchDraft(row);
  assert.equal(draft.productName, "Молоко 3,2 %");
  assert.equal(draft.supplier, "Молзавод / ООО «Поставка»");
  assert.equal(draft.quantity, 120);
  assert.equal(draft.unit, "kg");
  assert.equal(draft.receivedAt, "2026-09-10");
  assert.equal(draft.expiryDate, "2026-09-17");
  assert.match(draft.notes ?? "", /ТТН 451/);
});

test("черновик партии не падает на пустой и нестандартной строке", () => {
  const empty = acceptanceRowToBatchDraft(
    createAcceptanceRow({ deliveryDate: "не указана", productName: "Соль" })
  );
  assert.equal(empty.quantity, 0);
  assert.equal(empty.unit, "kg");
  assert.equal(empty.receivedAt, null);
  assert.equal(empty.expiryDate, null);
  assert.equal(empty.supplier, null);
  assert.equal(empty.notes, null);

  assert.deepEqual(parseAcceptanceQuantity("20 шт"), { quantity: 20, unit: "pcs" });
  assert.deepEqual(parseAcceptanceQuantity("1,5 л"), { quantity: 1.5, unit: "l" });
  assert.deepEqual(parseAcceptanceQuantity(""), { quantity: 0, unit: "kg" });
});

test("партию по строке создаём один раз и только по принятой строке", () => {
  const accepted = createAcceptanceRow({ productName: "Мука", acceptanceDecision: "accept" });
  assert.equal(canCreateBatchFromAcceptanceRow(accepted), true);
  // Уже созданная партия — второй раз нельзя.
  assert.equal(
    canCreateBatchFromAcceptanceRow({ ...accepted, batchId: "batch-1" }),
    false
  );
  // Отклонённая поставка партией на складе не становится.
  assert.equal(
    canCreateBatchFromAcceptanceRow({ ...accepted, acceptanceDecision: "reject" }),
    false
  );
  // Без наименования партию заводить нечем.
  assert.equal(canCreateBatchFromAcceptanceRow({ ...accepted, productName: "" }), false);
  // Ссылка на партию переживает нормализацию конфига.
  const config = normalizeAcceptanceDocumentConfig(
    { rows: [{ ...accepted, batchId: "batch-1", batchCode: "B-20260910-001" }] },
    []
  );
  assert.equal(config.rows[0].batchId, "batch-1");
  assert.equal(config.rows[0].batchCode, "B-20260910-001");
});
