import test from "node:test";
import assert from "node:assert/strict";

import {
  PPK_RECORD_BLOCKS,
  PPK_RECORD_LIMITS,
  PPK_RECORD_SCHEMAS,
  PPK_SINGLETON_BLOCKS,
  isPpkRecordBlock,
  parsePpkRecords,
  checkTeamGroup,
} from "./records";

const ok = (block: (typeof PPK_RECORD_BLOCKS)[number], data: unknown) =>
  PPK_RECORD_SCHEMAS[block].safeParse(data).success;

test("блоки записей и лимиты", () => {
  assert.deepEqual([...PPK_RECORD_BLOCKS], ["team", "policy", "products", "hazards", "control-points", "flowchart", "floor-plan", "pest-plan", "lab-plan", "norms", "doc-versions", "team-meetings"]);
  assert.equal(isPpkRecordBlock("team"), true);
  assert.equal(isPpkRecordBlock("flowchart"), true);
  assert.equal(isPpkRecordBlock("unknown"), false);
  assert.equal(isPpkRecordBlock(undefined), false);
  assert.deepEqual(PPK_RECORD_LIMITS, { team: 30, policy: 1, products: 300, hazards: 300, "control-points": 200, flowchart: 50, "floor-plan": 50, "pest-plan": 100, "lab-plan": 100, norms: 1, "doc-versions": 200, "team-meetings": 200 });
});

test("план дезинсекции и лаборатории: вид, периодичность 1..24 месяцев, даты YYYY-MM-DD", () => {
  const pest = { kind: "disinsection", object: "Все помещения", frequency: "Ежемесячно", contractor: "", lastDate: null, nextDate: "2026-11-01" };
  assert.equal(ok("pest-plan", pest), true);
  assert.equal(ok("pest-plan", { ...pest, kind: "fumigation" }), false);
  assert.equal(ok("pest-plan", { ...pest, nextDate: "01.11.2026" }), false);
  const lab = { object: "swabs", subject: "Смывы", indicator: "БГКП", everyMonths: 3, laboratory: "", lastDate: "2026-10-01" };
  assert.equal(ok("lab-plan", lab), true);
  assert.equal(ok("lab-plan", { ...lab, everyMonths: 0 }), false);
  assert.equal(ok("lab-plan", { ...lab, everyMonths: 25 }), false);
  assert.equal(ok("lab-plan", { ...lab, object: "milk" }), false);
});

test("состав группы: роль из списка, пустые строки отсекаются", () => {
  assert.equal(ok("team", { userId: "u1", role: "leader", duties: "  Ведёт группу  " }), true);
  assert.equal(ok("team", { userId: "u1", role: "boss", duties: "" }), false);
  assert.equal(ok("team", { userId: "", role: "member", duties: "" }), false);
  const parsed = PPK_RECORD_SCHEMAS.team.parse({ userId: "u1", role: "member", duties: "  x  " }) as { duties: string };
  assert.equal(parsed.duties, "x");
});

test("политика: текст, утверждение и дата YYYY-MM-DD; токен клиент не шлёт", () => {
  assert.equal(ok("policy", { text: "Текст", approvedById: null, approvedAt: null }), true);
  assert.equal(ok("policy", { text: "Текст", approvedById: "u1", approvedAt: "2026-10-16" }), true);
  assert.equal(ok("policy", { text: "Текст", approvedById: "u1", approvedAt: "16.10.2026" }), false);
  assert.equal(ok("policy", { text: "x".repeat(12001), approvedById: null, approvedAt: null }), false);
  const parsed = PPK_RECORD_SCHEMAS.policy.parse({ text: "T", approvedById: null, approvedAt: null, token: "evil" }) as Record<string, unknown>;
  assert.equal("token" in parsed, false);
});

test("продукт: категория из списка, длинные поля до 4000, показатели до 30", () => {
  const base = {
    name: "Борщ",
    category: "ready-meals",
    composition: "свёкла, капуста",
    storage: "при 0…+6 °C",
    shelfLife: "24 ч",
    usage: "подогреть",
    packaging: "контейнер",
    indicators: [{ name: "КМАФАнМ", norm: "не более 1·10^4" }],
  };
  assert.equal(ok("products", base), true);
  assert.equal(ok("products", { ...base, category: "sweets" }), false);
  assert.equal(ok("products", { ...base, composition: "x".repeat(4001) }), false);
  assert.equal(ok("products", { ...base, indicators: Array.from({ length: 31 }, () => ({ name: "a", norm: "b" })) }), false);
});

test("опасность: вероятность и тяжесть только 1..4", () => {
  const base = { step: "Приёмка", hazard: "Сальмонелла", type: "bio", probability: 2, severity: 3, measures: "" };
  assert.equal(ok("hazards", base), true);
  assert.equal(ok("hazards", { ...base, probability: 5 }), false);
  assert.equal(ok("hazards", { ...base, severity: 0 }), false);
  assert.equal(ok("hazards", { ...base, type: "radiation" }), false);
});

test("ККТ: для ccp/oprp номер обязателен; ссылки nullable", () => {
  const answers = { q1: true, q2: true, q3: null, q4: null };
  const base = {
    hazardId: null,
    kind: "ccp",
    answers,
    number: "ККТ-1",
    limits: "≥ 72 °C",
    monitoring: "термометр",
    frequency: "каждая партия",
    responsibleId: null,
    corrective: "довести до нормы",
    journalCode: null,
  };
  assert.equal(ok("control-points", base), true);
  assert.equal(ok("control-points", { ...base, number: "" }), false);
  assert.equal(ok("control-points", { ...base, kind: "prp", number: "" }), true);
  assert.equal(ok("control-points", { ...base, kind: "magic" }), false);
});

test("ККТ: числовые пределы необязательны, старые записи проходят; от > до — ошибка", () => {
  const base = {
    hazardId: null, kind: "ccp", answers: { q1: true, q2: true, q3: null, q4: null }, number: "ККТ-1",
    limits: "", monitoring: "", frequency: "", responsibleId: null, corrective: "", journalCode: null,
  };
  const parsed = PPK_RECORD_SCHEMAS["control-points"].safeParse(base);
  assert.equal(parsed.success, true);
  const out = (parsed.success ? parsed.data : {}) as { limitMin?: number | null; limitMax?: number | null; unit?: string };
  assert.deepEqual([out.limitMin, out.limitMax, out.unit], [null, null, ""]);
  assert.equal(ok("control-points", { ...base, limitMin: 75, limitMax: null, unit: "°C" }), true);
  assert.equal(ok("control-points", { ...base, limitMin: 2, limitMax: 6 }), true);
  assert.equal(ok("control-points", { ...base, limitMin: 7, limitMax: 6 }), false);
  assert.equal(ok("control-points", { ...base, unit: "x".repeat(17) }), false);
});

test("нормативы: выбранные id из каталога и свои документы; лимиты 50 и 300 символов", () => {
  const base = { selected: ["fz-52", "sanpin-4282"], custom: [{ title: "ГОСТ 31987-2012" }] };
  assert.equal(ok("norms", base), true);
  assert.equal(ok("norms", { selected: [], custom: [] }), true);
  assert.equal(ok("norms", { ...base, selected: ["nope-1"] }), false);
  assert.equal(ok("norms", { ...base, selected: Array.from({ length: 51 }, () => "fz-52") }), false);
  assert.equal(ok("norms", { ...base, custom: Array.from({ length: 51 }, () => ({ title: "a" })) }), false);
  assert.equal(ok("norms", { ...base, custom: [{ title: "x".repeat(301) }] }), false);
  assert.equal(ok("norms", { ...base, custom: [{ title: "   " }] }), false);
  const parsed = PPK_RECORD_SCHEMAS.norms.parse({ ...base, custom: [{ title: "  Док  " }] }) as { custom: { title: string }[] };
  assert.equal(parsed.custom[0].title, "Док");
});

test("parsePpkRecords: битые строки отбрасываются, токен политики сохраняется", () => {
  const at = new Date("2026-10-16T00:00:00Z");
  const team = parsePpkRecords("team", [
    { id: "a", data: { userId: "u1", role: "leader", duties: "" }, sortOrder: 1, updatedAt: at },
    { id: "b", data: { userId: "u2", role: "boss" }, sortOrder: 2, updatedAt: at },
    { id: "c", data: null, sortOrder: 3, updatedAt: at },
  ]);
  assert.deepEqual(team.map((r) => r.id), ["a"]);
  assert.equal(team[0].data.role, "leader");
  const policy = parsePpkRecords("policy", [
    { id: "p", data: { text: "T", approvedById: null, approvedAt: null, token: "tok123" }, sortOrder: 1, updatedAt: at },
  ]);
  assert.equal(policy[0].data.token, "tok123");
});

test("checkTeamGroup: один руководитель, сотрудник не повторяется", () => {
  const others = [{ userId: "u1", role: "leader" as const, duties: "" }];
  assert.equal(checkTeamGroup(others, { userId: "u2", role: "member", duties: "" }), null);
  assert.equal(checkTeamGroup(others, { userId: "u2", role: "leader", duties: "" }), "Руководитель группы уже назначен");
  assert.equal(checkTeamGroup(others, { userId: "u1", role: "member", duties: "" }), "Сотрудник уже в группе");
  assert.equal(checkTeamGroup([], { userId: "u1", role: "leader", duties: "" }), null);
});

test("блоки-одиночки — ровно те, у которых лимит 1", () => {
  const singles = PPK_RECORD_BLOCKS.filter((block) => PPK_RECORD_LIMITS[block] === 1);
  assert.deepEqual([...PPK_SINGLETON_BLOCKS].sort(), [...singles].sort());
  assert.deepEqual([...PPK_SINGLETON_BLOCKS], ["policy", "norms"]);
});

test("версия документа: ППК или ХАССП-план, номер 1..999, дата, комментарий до 500", () => {
  const version = { doc: "ppk", version: 3, approvedAt: "2026-10-12", approvedById: "u1", note: "Пересмотр" };
  assert.equal(ok("doc-versions", version), true);
  assert.equal(ok("doc-versions", { ...version, doc: "haccp-plan", approvedById: null }), true);
  assert.equal(ok("doc-versions", { ...version, doc: "policy" }), false);
  assert.equal(ok("doc-versions", { ...version, version: 0 }), false);
  assert.equal(ok("doc-versions", { ...version, version: 1000 }), false);
  assert.equal(ok("doc-versions", { ...version, version: 1.5 }), false);
  assert.equal(ok("doc-versions", { ...version, approvedAt: "12.10.2026" }), false);
  assert.equal(ok("doc-versions", { ...version, note: "я".repeat(501) }), false);
});

test("заседание группы: дата, тема 1..200, решения до 4000, присутствовавшие до 30", () => {
  const meeting = { date: "2026-10-12", topic: "Пересмотр анализа опасностей", decisions: "Решили.", attendeeIds: ["u1", "u2"] };
  assert.equal(ok("team-meetings", meeting), true);
  assert.equal(ok("team-meetings", { ...meeting, topic: "" }), false);
  assert.equal(ok("team-meetings", { ...meeting, topic: "я".repeat(201) }), false);
  assert.equal(ok("team-meetings", { ...meeting, decisions: "я".repeat(4001) }), false);
  assert.equal(ok("team-meetings", { ...meeting, date: "вчера" }), false);
  assert.equal(ok("team-meetings", { ...meeting, attendeeIds: Array.from({ length: 31 }, (_, i) => `u${i}`) }), false);
});
