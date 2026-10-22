import test from "node:test";
import assert from "node:assert/strict";
import { describePromotion, describePromotionChange } from "./promotions";
import { inferPromotionAuditPresentation, readPromotionAuditPresentation } from "./promotion-audit-presentation";

const base = { title: "Исходная", percent: 20, startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-01T00:00:00.000Z"), active: false, note: null as string | null };
const serialize = (value: typeof base) => ({ title: value.title, percent: value.percent, startsAt: value.startsAt.toISOString(), endsAt: value.endsAt.toISOString(), active: value.active });
const entry = (action: string, title: string, summary: string, presentation?: unknown) => ({ id: "audit", action, title, summary, presentation, promotionId: "promotion", userName: "Автор", at: base.startsAt.toISOString() });

test("whole-output replay preserves hostile titles and every change/note combination", () => {
  const titles = ["Осень", "заметка изменена", "без изменений", "включена; выключена", "A; скидка 20 → 30 %; заметка изменена", "«до» → «после»; конец 01.10.2026, 00:00", "<script>alert('x')</script>; constructor; __proto__"];
  const notes: [string | null, string | null][] = [[null,null],[null,""],["",""],["same","same"],[null,"new"],["old",null],["old","new"]];
  for (const title of titles) for (let mask = 0; mask < 32; mask++) for (const [oldNote, newNote] of notes) {
    const before = { ...base, title, note: oldNote }, after = { ...before, title: mask & 1 ? `${title}; заметка изменена → новое` : title, percent: mask & 2 ? 25 : 20, startsAt: mask & 4 ? new Date("2026-10-02T00:00:00.000Z") : base.startsAt, endsAt: mask & 8 ? new Date("2026-11-02T00:00:00.000Z") : base.endsAt, active: Boolean(mask & 16), note: newNote };
    const summary = describePromotionChange(before, after);
    const action = before.active !== after.active && summary === (after.active ? "включена" : "выключена") ? after.active ? "promotion.enable" : "promotion.disable" : "promotion.update";
    const details = { title: after.title, summary, before: serialize(before), after: serialize(after) }, original = JSON.stringify(details);
    const result = inferPromotionAuditPresentation(action, details);
    assert.equal(result?.kind, "change");
    if (result?.kind !== "change") throw new Error("missing change");
    assert.equal(result.noteChanged, (oldNote ?? "") !== (newNote ?? ""));
    assert.equal(result.before.title, title); assert.equal(result.after.title, after.title);
    assert.equal(Object.hasOwn(result.before, "note"), false);
    assert.deepEqual(readPromotionAuditPresentation(entry(action, after.title, summary, result)), result);
    assert.equal(JSON.stringify(details), original);
  }
});
test("create/delete/toggles, conservative unknown and wire validation", () => {
  for (const active of [false,true]) for (const action of ["promotion.create","promotion.delete"]) {
    const value = { ...base, active }, summary = describePromotion(value) + (action === "promotion.create" && !active ? " · выключена" : "");
    const result = inferPromotionAuditPresentation(action, { ...serialize(value), summary, note: "PRIVATE" });
    assert.ok(result); assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
    assert.deepEqual(readPromotionAuditPresentation(entry(action, value.title, summary, result)), result);
    assert.equal(readPromotionAuditPresentation(entry(action, value.title, summary, { ...result, version: 2 })), undefined);
  }
  const after = { ...base, percent: 25 }, summary = describePromotionChange(base, after), details = { title: base.title, summary, before: serialize(base), after: serialize(after) };
  for (const invalid of [null, [], {}, { ...details, summary: "custom; заметка изменена" }, { ...details, title: "wrong" }, { ...details, before: Object.create(details.before) }, { ...details, after: { ...details.after, active: "true" } }, { ...details, before: { ...details.before, startsAt: "2026-10-01" } }, { ...details, before: { ...details.before, percent: NaN } }]) assert.equal(inferPromotionAuditPresentation("promotion.update", invalid), undefined);
  for (const action of ["constructor","__proto__","promotion.future","promotion.enable"]) assert.equal(inferPromotionAuditPresentation(action, details), undefined);
  const valid = inferPromotionAuditPresentation("promotion.update", details);
  assert.equal(readPromotionAuditPresentation(entry("promotion.update", base.title, summary, { ...valid, noteChanged: true })), undefined);
  assert.equal(readPromotionAuditPresentation(entry("promotion.update", base.title, summary, Object.create(valid!))), undefined);
});
