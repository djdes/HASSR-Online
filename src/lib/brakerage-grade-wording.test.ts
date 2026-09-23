import assert from "node:assert/strict";
import test from "node:test";

import { modernizeGradeWording } from "@/lib/brakerage-grade-wording";
import {
  FINISHED_PRODUCT_ORGANOLEPTIC_DISH,
  FINISHED_PRODUCT_ORGANOLEPTIC_SEMI,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import { isSignatureOutdated, normalizeRowSignatures } from "@/lib/brakerage-commission";

/**
 * Решение владельца 2026-09-23: оценки «Доброкачественно / Недоброкачественно»
 * вместо «Доброкачественная / Недоброкачественная». Готовая продукция хранит
 * текст — старые записи показываются новыми словами при нормализации.
 */
test("старые формулировки переводятся, регистр первой буквы сохраняется", () => {
  assert.equal(modernizeGradeWording("Доброкачественная"), "Доброкачественно");
  assert.equal(modernizeGradeWording("доброкачественная"), "доброкачественно");
  assert.equal(modernizeGradeWording("Недоброкачественная"), "Недоброкачественно");
  assert.equal(modernizeGradeWording("Не доброкачественная"), "Недоброкачественно");
  assert.equal(modernizeGradeWording("не доброкачественная"), "недоброкачественно");
  assert.equal(modernizeGradeWording("  Доброкачественная "), "Доброкачественно");
});

test("прочие оценки и фритюр не трогаем", () => {
  assert.equal(modernizeGradeWording("Отлично"), "Отлично");
  assert.equal(modernizeGradeWording("Доброкачественное, без постороннего запаха"), "Доброкачественное, без постороннего запаха");
  assert.equal(modernizeGradeWording(""), "");
});

test("стандартные оценки — новые слова", () => {
  for (const list of [FINISHED_PRODUCT_ORGANOLEPTIC_DISH, FINISHED_PRODUCT_ORGANOLEPTIC_SEMI]) {
    assert.ok(list.includes("Доброкачественно"));
    assert.ok(list.includes("Недоброкачественно"));
    assert.ok(!list.some((item) => /качественная$/.test(item)));
  }
});

test("документ готовой продукции: строки, свои оценки и снимок подписи — новыми словами", () => {
  const snapshot = { productName: "Борщ", organoleptic: "Доброкачественная" };
  const config = normalizeFinishedProductDocumentConfig({
    rows: [
      {
        id: "r1",
        productName: "Борщ",
        organoleptic: "Доброкачественная",
        organolepticValue: "Не доброкачественная",
        organolepticResult: "недоброкачественная",
        signatures: [{ userId: "u1", name: "Иванова", role: "Член комиссии", signedAt: "2026-09-22T09:00:00.000Z", method: "qr", grade: "Доброкачественная", snapshot }],
      },
    ],
    organolepticOptions: ["Отлично", "Доброкачественная", "Доброкачественно", "Не доброкачественная"],
  });
  const row = config.rows[0];
  assert.equal(row.organoleptic, "Доброкачественно");
  assert.equal(row.organolepticValue, "Недоброкачественно");
  assert.equal(row.organolepticResult, "недоброкачественно");
  assert.deepEqual(config.organolepticOptions, ["Отлично", "Доброкачественно", "Недоброкачественно"]);
  // Подпись под старым словом не превращается в «изменено после подписи».
  const [signature] = normalizeRowSignatures(row.signatures);
  assert.equal(signature.grade, "Доброкачественно");
  assert.equal(isSignatureOutdated(row as unknown as Record<string, unknown>, signature), false);
});
