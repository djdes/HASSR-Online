import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTrainingPlanConfig } from "@/lib/training-plan-document";
import { buildTrainingRoleDisplay, captureTrainingProvenance, completeTrainingProvenance, presentTrainingApprover, presentTrainingItem, presentTrainingRole, presentTrainingStaffOption, trainingApprovalDate, trainingMonthLabels, type TrainingCopy } from "./training-plan-presentation";

const copy: TrainingCopy = (...args) => `${args[0]}:${JSON.stringify(args[1] ?? {})}`;
function prepared(raw: unknown) {
  const captured = captureTrainingProvenance(raw);
  const config = normalizeTrainingPlanConfig(raw);
  return { config, origin: completeTrainingProvenance(captured, config) };
}

test("native-injected array defaults translate; valid stored custom-identical values remain raw", () => {
  for (const raw of [undefined, null, false, 0, "", [], {},
    { topics: [], rows: [] }, { topics: null, rows: false }, { topics: undefined, rows: undefined },
    { topics: [{ id: "invalid", name: null }], rows: [null] },
    { topics: [false, [], {}, { id: "kkt", name: "" }], rows: [false, [], null] },
    { topics: new Array(3), rows: new Array(2) }]) {
    const { config, origin } = prepared(raw);
    assert.equal(presentTrainingItem("topics", config.topics[1], origin, copy), "sanitation:{}");
    assert.equal(presentTrainingItem("rows", config.rows[0], origin, copy), "head_chef:{}");
  }
  for (const raw of [normalizeTrainingPlanConfig({})]) {
    const { config, origin } = prepared(raw);
    assert.equal(presentTrainingItem("topics", config.topics[1], origin, copy), "Санитария и гигиена");
    assert.equal(presentTrainingItem("rows", config.rows[0], origin, copy), "Шеф-повар");
  }
  const { config, origin } = prepared({});
  assert.equal(presentTrainingItem("topics", { ...config.topics[0], name: "Custom" }, origin, copy), "Custom");
  assert.equal(presentTrainingItem("topics", { ...config.topics[0], id: "custom-id" }, origin, copy), "ККТ");
});

test("factory classifier preserves native training whitespace, partial arrays and descriptor uncertainty", () => {
  for (const approveRole of [undefined, null, false, 0, ""]) {
    const { config, origin } = prepared({ approveRole });
    assert.equal(origin.approveRole, true);
    assert.equal(presentTrainingApprover(config.approveRole, config, [], origin, copy), "manager:{}");
  }
  for (const approveRole of [" ", "Управляющий", "Custom"]) {
    const { config, origin } = prepared({ approveRole });
    assert.equal(origin.approveRole, false);
    assert.equal(presentTrainingApprover(config.approveRole, config, [], origin, copy), approveRole);
  }
  const raw = { topics: [null, { id: "kkt", name: "ККТ" }], rows: [null, { positionName: "Шеф-повар" }] };
  const stored = prepared(raw);
  assert.equal(stored.origin.topics, false);
  assert.equal(stored.origin.rows, false);
  assert.equal(presentTrainingItem("topics", stored.config.topics[0], stored.origin, copy), "ККТ");
  assert.equal(presentTrainingItem("rows", stored.config.rows[0], stored.origin, copy), "Шеф-повар");
  assert.equal(captureTrainingProvenance({ topics: [{ id: " ", name: " " }] }).topics, false);
  let reads = 0;
  const topic = Object.defineProperty({ id: "kkt" }, "name", { get() { reads++; return "ККТ"; } });
  const accessorArray = Object.defineProperty([], "0", { get() { reads++; return topic; }, configurable: true });
  const customPrototype = Object.create(Array.prototype);
  const exoticArray = Object.setPrototypeOf([], customPrototype);
  for (const topics of [[topic], accessorArray, exoticArray, [Object.create({ id: "kkt", name: "ККТ" })]]) {
    assert.equal(captureTrainingProvenance({ topics }).topics, false);
  }
  const toJSON = { topics: [], rows: [], toJSON() { reads++; throw new Error("not called"); } };
  assert.deepEqual(captureTrainingProvenance(toJSON), { topics: true, rows: true, approveRole: true });
  assert.equal(reads, 0);
});

test("capture never evaluates getters and preserves native normalization reads and exceptions", () => {
  const reads: string[] = [];
  const raw = Object.defineProperties({}, Object.fromEntries(["year", "documentDate", "topics", "rows", "approveRole", "approveEmployeeId", "approveEmployee"].map(key => [key, { get() { reads.push(key); return undefined; } }])));
  captureTrainingProvenance(raw);
  assert.deepEqual(reads, []);
  normalizeTrainingPlanConfig(raw);
  const nativeReads = [...reads];
  reads.length = 0;
  prepared(raw);
  assert.deepEqual(reads, nativeReads);
  const failure = new Error("native failure");
  const throwing = Object.defineProperty({}, "topics", { get() { throw failure; } });
  assert.doesNotThrow(() => captureTrainingProvenance(throwing));
  assert.throws(() => prepared(throwing), error => error === failure);
  for (const raw of [Object.create({ topics: undefined }), new Date()]) {
    assert.deepEqual(captureTrainingProvenance(raw), { topics: false, rows: false, approveRole: false });
  }
});

test("enum and legacy role provenance translates; custom identical collisions and unknowns stay raw", () => {
  const enumUser = { id: "manager", name: "Person", role: "owner" };
  const display = buildTrainingRoleDisplay([enumUser]);
  assert.equal(presentTrainingRole("Управляющий", display, copy), "manager:{}");
  for (const custom of [{ positionTitle: "Управляющий" }, { jobPosition: { name: "Управляющий" } }]) {
    assert.equal(presentTrainingRole("Управляющий", buildTrainingRoleDisplay([enumUser, { id: "custom", role: "cook", name: "Custom", ...custom }]), copy), "Управляющий");
  }
  assert.equal(presentTrainingRole("Custom", buildTrainingRoleDisplay([{ id: "x", role: "Custom" }]), copy), "Custom");
  const { config, origin } = prepared({});
  assert.equal(presentTrainingApprover("Управляющий", config, [], origin, copy), "manager:{}");
  const explicit = prepared({ approveRole: "Управляющий" });
  assert.equal(presentTrainingApprover("Управляющий", explicit.config, [], explicit.origin, copy), "Управляющий");
  assert.equal(presentTrainingApprover("Управляющий", { ...config, approveEmployeeId: "manager" }, [enumUser], origin, copy), "manager:{}");
  assert.equal(presentTrainingApprover("Управляющий", { ...config, approveEmployeeId: "gone" }, [], origin, copy), "Управляющий");
});

test("month display keeps 12 native values; RU approval date matches the original format", () => {
  assert.deepEqual(trainingMonthLabels("ru"), ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]);
  assert.equal(trainingMonthLabels("en")[0], "January");
  assert.equal(trainingMonthLabels("uz")[0], "Yanvar");
  assert.equal(trainingApprovalDate("2027-01-11", "ru", copy), "« 11 » января 2027 г.");
  assert.equal(trainingApprovalDate("raw", "en", copy), "raw");
  assert.equal(trainingApprovalDate("2027-01-11", "en", copy), 'approvalDate:{"day":"11","month":"January","year":"2027"}');
  assert.equal(trainingApprovalDate("2027-01-11", "uz", copy), 'approvalDate:{"day":"11","month":"Yanvar","year":"2027"}');
});

test("native staff labels translate enum prefix and unnamed fallback without translating literal names", () => {
  const user = { id: "x", role: "cook", name: "Повар" };
  const display = buildTrainingRoleDisplay([user]);
  assert.equal(presentTrainingStaffOption("Повар - Повар", user, display, copy, "unnamed"), "cook:{} - Повар");
  assert.equal(presentTrainingStaffOption("Повар - без имени", { ...user, name: "без имени" }, display, copy, "unnamed"), "cook:{} - без имени");
  assert.equal(presentTrainingStaffOption("Повар - без имени", { ...user, name: "" }, display, copy, "unnamed"), "cook:{} - unnamed");
  assert.equal(presentTrainingStaffOption("Повар - без имени", { ...user, name: "owner@example.org" }, display, copy, "unnamed"), "cook:{} - unnamed");
  const custom = { ...user, jobPosition: { name: "Повар" } };
  assert.equal(presentTrainingStaffOption("Повар - Повар", custom, buildTrainingRoleDisplay([custom]), copy, "unnamed"), "Повар - Повар");
  let reads = 0;
  const unsafe = Object.defineProperty({ ...user }, "name", { get() { reads++; return ""; } });
  assert.equal(presentTrainingStaffOption("Повар - без имени", unsafe, display, copy, "unnamed"), "Повар - без имени");
  assert.equal(reads, 0);
});
