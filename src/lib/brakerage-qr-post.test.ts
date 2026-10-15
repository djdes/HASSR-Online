import assert from "node:assert/strict";
import test from "node:test";
import { parseBrakerageListPost } from "@/lib/brakerage-qr-post";

const rows = [
  { documentId: "d1", rowId: "r1", name: "Суп", time: "12:40", grade: "Отлично", portionWeight: "250", rejectionTime: "12:45" },
  { documentId: "d1", rowId: "r2", name: "Каша", time: "12:50", grade: "Отлично", portionWeight: "200", rejectionTime: "12:55" },
];
const options = { isFinished: true, gradeValues: ["Отлично", "Хорошо", "Неудовлетворительно"] };
const evaluator = { editor: false, evaluator: true, viewer: false };
const form = (values: Record<string, string>) => (name: string) => values[name];

test("preparer edits dish, production HHMM, weight and grade without signing", () => {
  const result = parseBrakerageListPost(form({ "name:r1": "Суп куриный", "time:r1": "1235", "w:r1": "300", "grade:r1": "Хорошо", "note:r1": "Мало соли" }), rows, { editor: true, evaluator: false, viewer: false }, options);
  assert.deepEqual(result.editsByDoc.get("d1"), [{ rowId: "r1", name: "Суп куриный", time: "12:35", portionWeight: "300", grade: "Хорошо", note: "Мало соли" }]);
  assert.equal(result.signsByDoc.size, 0);
});

test("commission signs selected grades with own comments and corrected four-digit time", () => {
  const result = parseBrakerageListPost(form({ "name:r1": "Взлом", "w:r1": "999", "grade:r1": "Хорошо", "note:r1": " Мало соли ", "rej:r1": "1300", "grade:r2": "Неудовлетворительно", "note:r2": "Подгорело", "adm:r2": "yes" }), rows, evaluator, options);
  assert.equal(result.error, undefined);
  assert.equal(result.editsByDoc.size, 0);
  assert.deepEqual(result.signsByDoc.get("d1"), [
    { rowId: "r1", grade: "Хорошо", note: "Мало соли", rejectionTime: "1300" },
    { rowId: "r2", grade: "Неудовлетворительно", note: "Подгорело" },
  ]);
});

test("no chosen grade never signs, including forged legacy admission", () => {
  const result = parseBrakerageListPost(form({ "adm:r1": "yes" }), rows, evaluator, options);
  assert.equal(result.signsByDoc.size, 0);
});

test("non-excellent grade requires a fresh nonblank comment and cancels the entire batch", () => {
  for (const comment of ["", "  "]) {
    const result = parseBrakerageListPost(form({ "grade:r1": "Отлично", "grade:r2": "Хорошо", "note:r2": comment }), rows, evaluator, options);
    assert.match(result.error!, /комментарий/);
    assert.equal(result.signsByDoc.size, 0);
    assert.equal(result.editsByDoc.size, 0);
  }
});

test("excellent needs no comment, arbitrary grades and invalid times fail explicitly", () => {
  assert.equal(parseBrakerageListPost(form({ "grade:r1": "Отлично" }), rows, evaluator, options).signsByDoc.size, 1);
  assert.match(parseBrakerageListPost(form({ "grade:r1": "<script>" }), rows, evaluator, options).error!, /оценку/);
  for (const time of ["13:00", "130", "2500", "2360", "1e30", "1.30"]) {
    const result = parseBrakerageListPost(form({ "grade:r1": "Отлично", "rej:r1": time }), rows, evaluator, options);
    assert.match(result.error!, /четырьмя цифрами/);
    assert.equal(result.signsByDoc.size, 0);
  }
});

test("viewer cannot modify or sign even with forged form fields", () => {
  const result = parseBrakerageListPost(form({ "grade:r1": "Хорошо", "note:r1": "...", "name:r1": "Другое" }), rows, { editor: false, evaluator: false, viewer: true }, options);
  assert.equal(result.editsByDoc.size, 0);
  assert.equal(result.signsByDoc.size, 0);
});
