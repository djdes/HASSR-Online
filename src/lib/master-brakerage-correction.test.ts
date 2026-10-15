import { test } from "node:test";
import assert from "node:assert/strict";
import { captureMasterDelivery, planMasterCorrection, recoverMasterDelivery } from "./master-brakerage-correction";
import { planMasterBrakerageRows } from "./master-brakerage-plan";
import type { MasterBrakerageHistoryInput } from "./master-brakerage-history";

const input = (): MasterBrakerageHistoryInput => ({ date: "2026-10-15", rows: [{ name: "Суп", yield: "200", time: "09:00" }, { name: "Компот", yield: "150", time: "10:00" }], common: { time: "", organoleptic: "", releaseAllowed: "yes", productTemp: "", note: "" } });
function fixture() {
  const source = input();
  const rows = planMasterBrakerageRows({ rawConfig: {}, rows: source.rows, common: { ...source.common, date: source.date }, people: { responsibleName: "Повар", verifierName: "Проверяющий" } }).rows;
  const raw = { rows, organizationName: "Пищеблок", unrelatedSetting: { keep: 1 } };
  return { source, raw, delivery: captureMasterDelivery(source, rows) };
}

test("correction retains row IDs, staff identity and custom metadata while changing the dish", () => {
  const f = fixture(); const next = input(); next.rows[0].name = "Борщ";
  const raw = { ...f.raw, rows: f.raw.rows.map(row => ({ ...row, custom: { "custom:one": "keep" }, localFlag: "preserve" })) };
  const result = planMasterCorrection({ rawConfig: raw, delivery: f.delivery, next });
  const rows = result.config.rows as typeof raw.rows;
  assert.equal(rows[0].id, f.raw.rows[0].id); assert.equal(rows[0].productName, "Борщ");
  assert.equal(rows[0].responsiblePerson, "Повар"); assert.equal(rows[0].localFlag, "preserve");
  assert.deepEqual(rows[1], raw.rows[1]); assert.deepEqual(result.config.unrelatedSetting, { keep: 1 });
});

test("a later all-recipient correction uses each recipient's own previously applied version", () => {
  const a = fixture(), b = fixture(); const edit = input(); edit.rows[0].name = "Борщ";
  const first = planMasterCorrection({ rawConfig: a.raw, delivery: a.delivery, next: edit });
  const final = structuredClone(edit); final.rows[0].name = "Щи";
  const a2 = planMasterCorrection({ rawConfig: first.config, delivery: first.delivery, next: final });
  const b2 = planMasterCorrection({ rawConfig: b.raw, delivery: b.delivery, next: final });
  assert.equal(a2.delivery.rows[0].row.productName, "Щи"); assert.equal(b2.delivery.rows[0].row.productName, "Щи");
  assert.equal(a2.delivery.rows[0].row.id, a.raw.rows[0].id); assert.equal(b2.delivery.rows[0].row.id, b.raw.rows[0].id);
});

test("adding and deleting positions preserves unrelated journal rows", () => {
  const f = fixture(); const next = input(); next.rows.pop();
  const extra = { ...f.raw.rows[1], id: "unrelated", productName: "Чужое блюдо" };
  const deleted = planMasterCorrection({ rawConfig: { ...f.raw, rows: [...f.raw.rows, extra] }, delivery: f.delivery, next });
  assert.equal((deleted.config.rows as unknown[]).length, 2);
  next.rows.push({ name: "Каша", yield: "100", time: "11:00" });
  const added = planMasterCorrection({ rawConfig: deleted.config, delivery: deleted.delivery, next });
  assert.equal((added.config.rows as unknown[]).length, 3); assert.equal(added.delivery.rows[1].row.productName, "Каша");
});

test("signatures, signature-event IDs and checked metadata prevent modification and deletion", () => {
  for (const protectedFields of [{ signatures: [{ userId: "u" }] }, { verifiedAt: "2026-10-15" }, { verificationStatus: "approved" }, { checked: true }, {}]) {
    const f = fixture(); const next = input(); next.rows[0].name = "Правка";
    const raw = { ...f.raw, rows: [{ ...f.raw.rows[0], ...protectedFields }, f.raw.rows[1]] };
    const protectedRowIds = Object.keys(protectedFields).length ? undefined : new Set([f.raw.rows[0].id]);
    assert.throws(() => planMasterCorrection({ rawConfig: raw, delivery: f.delivery, next, protectedRowIds }), /подписана или проверена/);
    const noChanges = planMasterCorrection({ rawConfig: raw, delivery: f.delivery, next: input(), protectedRowIds });
    assert.equal(noChanges.changedRowIds.length, 0);
  }
  const f = fixture(); const next = input(); next.rows.pop();
  assert.throws(() => planMasterCorrection({ rawConfig: f.raw, delivery: f.delivery, next, protectedRowIds: new Set([f.raw.rows[1].id]) }), /подписана/);
});

test("a signed unchanged position does not prevent correcting a different unsigned position", () => {
  const f = fixture(); const next = input(); next.rows[1].name = "Морс";
  const result = planMasterCorrection({ rawConfig: f.raw, delivery: f.delivery, next, protectedRowIds: new Set([f.raw.rows[0].id]) });
  assert.deepEqual(result.changedRowIds, [f.raw.rows[1].id]);
});

test("deleting or inserting before an unchanged signed dish retains its actual journal row", () => {
  const f = fixture(); const next = input(); next.rows.shift();
  const result = planMasterCorrection({ rawConfig: f.raw, delivery: f.delivery, next, protectedRowIds: new Set([f.raw.rows[1].id]) });
  assert.equal(result.delivery.rows[0].row.id, f.raw.rows[1].id);
  assert.deepEqual(result.changedRowIds, [f.raw.rows[0].id]);
  next.rows.unshift({ name: "Новое блюдо", yield: "100", time: "08:00" });
  const inserted = planMasterCorrection({ rawConfig: result.config, delivery: result.delivery, next, protectedRowIds: new Set([f.raw.rows[1].id]) });
  assert.equal(inserted.delivery.rows[1].row.id, f.raw.rows[1].id);
  assert.equal(inserted.changedRowIds.length, 1);
});

test("local conflicts stop corrections; unrelated local edits are preserved and never adopted as permission to overwrite", () => {
  const f = fixture(); const next = input(); next.rows[0].name = "Борщ";
  const raw = { ...f.raw, rows: [{ ...f.raw.rows[0], productionDateTime: "2026-10-15 09:30" }, f.raw.rows[1]] };
  const first = planMasterCorrection({ rawConfig: raw, delivery: f.delivery, next });
  assert.equal((first.config.rows as typeof raw.rows)[0].productionDateTime, "2026-10-15 09:30");
  next.rows[0].time = "11:00";
  assert.throws(() => planMasterCorrection({ rawConfig: first.config, delivery: first.delivery, next }), /изменена в пищеблоке/);
  // A local product-name conflict must be rejected regardless of other fields.
  assert.throws(() => planMasterCorrection({ rawConfig: { rows: [{ ...f.raw.rows[0], productName: "Правка повара" }, f.raw.rows[1]] }, delivery: f.delivery, next }), /изменена в пищеблоке/);
});

test("collision detection covers a modified row before and after an unrelated row", () => {
  for (const before of [false, true]) {
    const f = fixture(); const next = input(); next.rows[0].name = "Борщ";
    const collision = { ...f.raw.rows[0], id: "other", productName: "Борщ" };
    assert.throws(() => planMasterCorrection({ rawConfig: { rows: before ? [collision, ...f.raw.rows] : [...f.raw.rows, collision] }, delivery: f.delivery, next }), /уже есть/);
  }
});

test("legacy recovery requires a unique original row and does not claim skipped duplicates", () => {
  const f = fixture(); assert.equal(recoverMasterDelivery(f.raw, f.source).rows.length, 2);
  assert.throws(() => recoverMasterDelivery({ rows: [...f.raw.rows, { ...f.raw.rows[0], id: "ambiguous" }] }, f.source), /однозначно/);
  assert.equal(recoverMasterDelivery(f.raw, f.source, ["Суп"]).rows.length, 1);
  assert.throws(() => recoverMasterDelivery({ rows: [] }, f.source), /однозначно/);
});

test("deletion refuses local custom fields and inspector changes even before a signature", () => {
  for (const patch of [{ custom: { "custom:one": "Внесено пищеблоком" } }, { inspectorName: "Другой проверяющий" }, { localNote: "Сохранить" }]) {
    const f = fixture(), next = input(); next.rows.pop();
    const raw = { ...f.raw, rows: [f.raw.rows[0], { ...f.raw.rows[1], ...patch }] };
    assert.throws(() => planMasterCorrection({ rawConfig: raw, delivery: f.delivery, next }), /перед удалением/);
  }
});

test("appended dishes use explicit document people only; absent defaults remain empty", () => {
  const f = fixture(), next = input(); next.rows.push({ name: "Каша", yield: "100", time: "11:00" });
  const blank = planMasterCorrection({ rawConfig: f.raw, delivery: f.delivery, next });
  assert.equal(blank.delivery.rows[2].row.responsiblePerson, "");
  const explicit = planMasterCorrection({ rawConfig: f.raw, delivery: f.delivery, next, people: { responsibleName: "Назначенный повар", verifierName: "Назначенный проверяющий" } });
  assert.equal(explicit.delivery.rows[2].row.responsiblePerson, "Назначенный повар");
  assert.equal(explicit.delivery.rows[2].row.inspectorName, "Назначенный проверяющий");
});
