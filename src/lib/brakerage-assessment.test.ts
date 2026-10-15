import assert from "node:assert/strict";
import test from "node:test";
import { aggregateBrakerageAssessment, allCommissionMembersAssessed, brakerageCommentRequired, brakerageRelease, brakerageTimeDigits, formatBrakerageDateTime, parseBrakerageTimeDigits } from "./brakerage-assessment";
import { createFinishedProductRow, finishedProductCellText } from "./finished-product-document";
import { mergeBrakerageConfig, BrakerageInputError } from "./brakerage-row-merge";
import { normalizeRowSignatures, todaySignatureSummary } from "./brakerage-commission";

test("release and comment rules cover all standard grades and legacy poor quality", () => {
  for (const grade of ["Отлично", "Хорошо", "Удовлетворительно", "Доброкачественно"]) assert.equal(brakerageRelease(grade), "yes");
  for (const grade of ["Неудовлетворительно", "Недоброкачественно", "Не доброкачественная"]) assert.equal(brakerageRelease(grade), "no");
  assert.equal(brakerageCommentRequired(" Отлично "), false);
  for (const grade of ["Хорошо", "Удовлетворительно", "Неудовлетворительно", "Доброкачественно", "Недоброкачественно"]) assert.equal(brakerageCommentRequired(grade), true);
});

test("another member's rejection survives positive grades; worst assessment is retained", () => {
  assert.deepEqual(aggregateBrakerageAssessment([{ grade: "Неудовлетворительно" }], "Отлично"), { grade: "Неудовлетворительно", releaseAllowed: "no" });
  assert.equal(aggregateBrakerageAssessment([{ grade: "Удовлетворительно" }], "Хорошо").grade, "Удовлетворительно");
});

test("HHMM accepts four digits only, boundary values and no punctuation or letters", () => {
  assert.equal(parseBrakerageTimeDigits("0000"), "00:00");
  assert.equal(parseBrakerageTimeDigits("2359"), "23:59");
  assert.equal(brakerageTimeDigits("2026-10-15 14:30"), "1430");
  for (const value of ["", "9:30", "09:30", "930", "09300", "2400", "1260", "1e30", " 0930", "０９３０"]) assert.equal(parseBrakerageTimeDigits(value), null);
});

const members = ["a", "b"].map(employeeId => ({ id: employeeId, employeeId, role: "Член комиссии", employeeName: employeeId }));
const sig = (userId: string, grade = "Отлично") => ({ userId, name: userId, role: "Член комиссии", signedAt: "2026-10-15T10:00:00Z", method: "session", grade });

test("queue completion needs every named member, not strangers or an empty commission", () => {
  assert.equal(allCommissionMembersAssessed({ signatures: [sig("a")] }, members), false);
  assert.equal(allCommissionMembersAssessed({ signatures: [sig("a"), sig("stranger")] }, members), false);
  assert.equal(allCommissionMembersAssessed({ signatures: [sig("a"), sig("b")] }, members), true);
  assert.equal(allCommissionMembersAssessed({ signatures: [sig("a"), sig("b", "")] }, members), false);
  assert.equal(allCommissionMembersAssessed({ signatures: [] }, []), false);
  assert.equal(allCommissionMembersAssessed({ signatures: [sig("a"), sig("b")] }, [...members, { ...members[0], employeeId: "" }]), false);
});

test("today's waiting counter agrees with full commission queue completion", () => {
  const row = { productionDateTime: "2026-10-15 12:00", productName: "Суп", signatures: [sig("a")] };
  assert.deepEqual(todaySignatureSummary({ commissionMembers: members, rows: [row] }, "2026-10-15"), { total: 1, waiting: 1 });
  assert.deepEqual(todaySignatureSummary({ commissionMembers: members, rows: [{ ...row, signatures: [sig("a"), sig("b")] }] }, "2026-10-15"), { total: 1, waiting: 0 });
});

test("queue ignores grading differences but retains dishes changed after assessment", () => {
  const row = { productName: "Суп", signatures: [{ ...sig("a", "Хорошо"), snapshot: { productName: "Суп", organoleptic: "Хорошо" } }, sig("b", "Отлично")] };
  assert.equal(allCommissionMembersAssessed(row, members), true);
  assert.equal(allCommissionMembersAssessed({ ...row, productName: "Каша" }, members), false);
});

test("date, rejection-only time and explicit fallback do not invent signatures", () => {
  const row = createFinishedProductRow({ productName: "Суп", productionDateTime: "2026-10-15 12:25", rejectionTime: "2026-10-15 12:30", responsiblePerson: "Повар" });
  assert.equal(formatBrakerageDateTime("2026-10-15"), "15-10-2026");
  assert.equal(finishedProductCellText(row, "production"), "15-10-2026 12:25");
  assert.equal(finishedProductCellText(row, "rejection"), "12:30");
  assert.equal(finishedProductCellText(row, "signatures"), "");
  assert.equal(finishedProductCellText(row, "signatures", { fallbackSignatureName: "Ответственный" }), "Ответственный");
  assert.equal(finishedProductCellText(createFinishedProductRow(), "signatures", { fallbackSignatureName: "Ответственный" }), "");
  assert.match(finishedProductCellText({ ...row, signatures: [sig("a")] }, "signatures", { fallbackSignatureName: "Ответственный" }), /^a/);
  assert.equal(row.signatures, undefined);
});

test("normalization retains each assessor's own comment", () => {
  assert.equal(normalizeRowSignatures([{ ...sig("a"), note: " Мало соли " }])[0].note, "Мало соли");
});

test("document writes enforce member add prohibition, comments and automatic release", () => {
  const current = { commissionMembers: members, rows: [{ id: "r1", productName: "Суп", organoleptic: "Отлично", signatures: [sig("b", "Неудовлетворительно")] }] };
  assert.throws(() => mergeBrakerageConfig({ current, incoming: { rows: [{ id: "new" }] }, knownRowIds: null, finishedProductActorId: "a" }), error => error instanceof BrakerageInputError && error.status === 403);
  assert.throws(() => mergeBrakerageConfig({ current, incoming: { rows: [{ id: "r1", organoleptic: "Хорошо" }] }, knownRowIds: null, finishedProductActorId: "cook" }), /комментарий/);
  const next = mergeBrakerageConfig({ current, incoming: { rows: [{ id: "r1", organoleptic: "Отлично", releaseAllowed: "yes" }] }, knownRowIds: null, finishedProductActorId: "cook" });
  assert.equal((next.rows as Array<{ releaseAllowed: string }>)[0].releaseAllowed, "no");
  assert.doesNotThrow(() => mergeBrakerageConfig({ current, incoming: { rows: [{ id: "blank", organoleptic: "", productName: "" }] }, knownRowIds: null, finishedProductActorId: "cook" }));
});
