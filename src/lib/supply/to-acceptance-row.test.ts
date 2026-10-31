import assert from "node:assert/strict";
import test from "node:test";

import {
  applySupplyCheck,
  supplyAccompanyingDocs,
  supplyBatchInfo,
  supplyItemToAcceptanceRow,
  type SupplyDocumentRef,
} from "./to-acceptance-row";
import type { SupplyItem } from "./upd";

const doc: SupplyDocumentRef = {
  id: "supply-1",
  source: "diadoc",
  number: "МД-1031",
  date: "2026-10-31",
  seller: { name: "ООО «Молочный двор»", inn: "7701234567", kpp: "770101001" },
  basis: "Договор поставки № 12/26 от 10.01.2026",
  shippedDate: "2026-10-31",
};

const milk: SupplyItem = {
  line: 1,
  name: "Молоко питьевое 3,2% 1 л",
  unit: "л",
  quantity: 40,
  price: 78.5,
  amount: 3454,
  code: null,
  expiryDate: "2026-11-05",
};

test("a document line fills only what the document knows; physical checks stay empty", () => {
  const row = supplyItemToAcceptanceRow({ doc, item: milk, responsibleTitle: "Заведующая производством", responsibleUserId: "u1" });
  assert.equal(row.productName, "Молоко питьевое 3,2% 1 л");
  assert.equal(row.supplier, "ООО «Молочный двор» (ИНН 7701234567)");
  assert.equal(row.accompanyingDocs, "УПД № МД-1031 от 31.10.2026 (Диадок); Договор поставки № 12/26 от 10.01.2026");
  assert.equal(row.batchInfo, "40 л");
  assert.equal(row.shelfLifeDate, "2026-11-05");
  assert.equal(row.deliveryDate, "2026-10-31");
  assert.equal(row.deliveryHour, "");
  assert.equal(row.productTemperature, "");
  assert.equal(row.acceptanceDecision, "");
  assert.equal(row.supplyDocumentId, "supply-1");
  assert.equal(row.supplyDocumentLine, "1");
  assert.equal(row.responsibleUserId, "u1");
});

test("the person's check is carried into the row", () => {
  const base = supplyItemToAcceptanceRow({ doc, item: { ...milk, expiryDate: null } });
  const accepted = applySupplyCheck(
    base,
    { deliveryHour: "08", deliveryMinute: "40", transportOk: true, documentsOk: true },
    { decision: "accept", packagingOk: true, organolepticOk: true, productTemperature: "+4", expiryDate: "2026-11-06" },
  );
  assert.equal(accepted.deliveryHour, "08");
  assert.equal(accepted.transportCondition, "satisfactory");
  assert.equal(accepted.documentCompliance, "Соответствует");
  assert.equal(accepted.productTemperature, "+4");
  assert.equal(accepted.shelfLifeDate, "2026-11-06");
  assert.equal(accepted.acceptanceDecision, "accept");
  const rejected = applySupplyCheck(
    base,
    { transportOk: false, documentsOk: false },
    { decision: "reject", packagingOk: false, organolepticOk: false, correctiveActions: "Возврат поставщику" },
  );
  assert.equal(rejected.transportCondition, "unsatisfactory");
  assert.equal(rejected.packagingCompliance, "non_compliant");
  assert.equal(rejected.organolepticResult, "unsatisfactory");
  assert.equal(rejected.acceptanceDecision, "reject");
  assert.equal(rejected.correctiveActions, "Возврат поставщику");
});

test("labels: documents column and quantities", () => {
  assert.equal(supplyAccompanyingDocs({ ...doc, source: "upload", basis: null }), "УПД № МД-1031 от 31.10.2026 (файл ЭДО)");
  assert.equal(supplyBatchInfo({ ...milk, quantity: 5.5, unit: "кг" }), "5,5 кг");
  assert.equal(supplyBatchInfo({ ...milk, quantity: 12, unit: null }), "12");
  assert.equal(supplyBatchInfo({ ...milk, quantity: null }), "");
});
