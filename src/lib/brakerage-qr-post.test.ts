import assert from "node:assert/strict";
import test from "node:test";

import { parseBrakerageListPost } from "@/lib/brakerage-qr-post";

/**
 * QR-список бракеража (решение владельца):
 *  • зав. производством правит блюдо, время изготовления, выход и оценку;
 *  • комиссия — только оценку и время бракеража; «Допущено»/«Не допущено»
 *    (по умолчанию ничего) — это и есть подпись.
 */
const rows = [
  { documentId: "d1", rowId: "r1", name: "Суп", time: "12:40", grade: "Отлично", portionWeight: "250", rejectionTime: "12:45" },
  { documentId: "d1", rowId: "r2", name: "Каша", time: "12:50", grade: "Отлично", portionWeight: "200", rejectionTime: "12:55" },
];
const grades = ["Отлично", "Хорошо", "Неудовлетворительно"];
const form = (values: Record<string, string>) => (name: string) => values[name];

test("зав: правка блюда, времени изготовления, выхода и оценки — без подписи", () => {
  const result = parseBrakerageListPost(
    form({ "name:r1": "Суп куриный", "time:r1": "12:35", "w:r1": "300", "grade:r1": "Хорошо", "adm:r1": "yes" }),
    rows,
    { editor: true, evaluator: false },
    { isFinished: true, gradeValues: grades }
  );
  assert.deepEqual(result.editsByDoc.get("d1"), [{ rowId: "r1", name: "Суп куриный", time: "12:35", portionWeight: "300", grade: "Хорошо" }]);
  assert.equal(result.signsByDoc.size, 0);
});

test("комиссия: только оценка и время бракеража, подпись — по «Допущено»/«Не допущено»", () => {
  const result = parseBrakerageListPost(
    form({ "name:r1": "Взлом", "w:r1": "999", "grade:r1": "Хорошо", "rej:r1": "13:00", "adm:r1": "yes", "grade:r2": "Неудовлетворительно", "adm:r2": "no" }),
    rows,
    { editor: false, evaluator: true },
    { isFinished: true, gradeValues: grades }
  );
  assert.equal(result.editsByDoc.size, 0);
  assert.deepEqual(result.signsByDoc.get("d1"), [
    { rowId: "r1", grade: "Хорошо", releaseAllowed: "yes", rejectionTime: "13:00" },
    { rowId: "r2", grade: "Неудовлетворительно", releaseAllowed: "no" },
  ]);
});

test("комиссия без выбора допуска ничего не подписывает; мусор в оценке и времени отбрасывается", () => {
  const none = parseBrakerageListPost(form({ "grade:r1": "Хорошо" }), rows, { editor: false, evaluator: true }, { isFinished: true, gradeValues: grades });
  assert.equal(none.signsByDoc.size, 0);
  const junk = parseBrakerageListPost(
    form({ "grade:r1": "<script>", "rej:r1": "99:99", "adm:r1": "yes" }),
    rows,
    { editor: false, evaluator: true },
    { isFinished: true, gradeValues: grades }
  );
  assert.deepEqual(junk.signsByDoc.get("d1"), [{ rowId: "r1", releaseAllowed: "yes" }]);
});

test("зав в комиссии: правки как зав + подпись, оценка уходит с подписью", () => {
  const result = parseBrakerageListPost(
    form({ "w:r1": "260", "grade:r1": "Хорошо", "adm:r1": "yes" }),
    rows,
    { editor: true, evaluator: true },
    { isFinished: true, gradeValues: grades }
  );
  assert.deepEqual(result.editsByDoc.get("d1"), [{ rowId: "r1", portionWeight: "260" }]);
  assert.deepEqual(result.signsByDoc.get("d1"), [{ rowId: "r1", grade: "Хорошо", releaseAllowed: "yes" }]);
});
