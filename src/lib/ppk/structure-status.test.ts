import { test } from "node:test";
import assert from "node:assert/strict";
import { PPK_BLOCKS, type PpkBlockKey } from "./registry";
import type { PpkStatus } from "./status";
import { PPK_STRUCTURE_ITEMS } from "./structure";
import { ppkItemProgress, ppkItemStatuses, ppkNextItem, type PpkItemFacts } from "./structure-status";
import {
  emptyProductionInfo,
  missingOrgInfo,
  missingProductionInfo,
  requiredOrgInfo,
} from "./structure-fields";
import type { DocumentOrgBlock } from "@/lib/document-org-block";

const blocks = (status: PpkStatus): Record<PpkBlockKey, PpkStatus> =>
  Object.fromEntries(PPK_BLOCKS.map((block) => [block.key, status])) as Record<PpkBlockKey, PpkStatus>;

function facts(patch: Partial<PpkItemFacts> = {}): PpkItemFacts {
  return {
    blocks: blocks("empty"),
    orgInfo: { required: 9, missing: 9 },
    orgCharts: { count: 0, maxNodes: 0 },
    contracts: { records: 0, files: 0 },
    productionInfo: { exists: false, missing: 4 },
    texts: {},
    folders: {},
    hazards: 0,
    teamOrder: false,
    prp: {},
    staff: 0,
    acquaintance: { available: false, acknowledged: 0, total: 0 },
    equipment: 0,
    journals: 0,
    ...patch,
  };
}

test("пустой кабинет: все 32 пункта пусты, следующий — 1.1", () => {
  const statuses = ppkItemStatuses(facts());
  assert.equal(Object.keys(statuses).length, PPK_STRUCTURE_ITEMS.length);
  assert.ok(Object.values(statuses).every((status) => status === "empty"));
  assert.deepEqual(ppkItemProgress(statuses), { done: 0, total: 32 });
  assert.equal(ppkNextItem(statuses)?.id, "1-1");
});

test("пункты блоков раздела берут статус блока", () => {
  const all = blocks("empty");
  all.products = "done";
  all.hazards = "started";
  all["control-points"] = "done";
  all.lab = "started";
  all.instructions = "done";
  const statuses = ppkItemStatuses(facts({ blocks: all }));
  assert.equal(statuses["1-5"], "done");
  assert.equal(statuses["2-6"], "started");
  assert.equal(statuses["2-10"], "done");
  assert.equal(statuses["app-2"], "done");
  assert.equal(statuses["3-6"], "started");
  assert.equal(statuses["app-6"], "done");
});

test("1.1: всё есть — заполнен; часть — начат", () => {
  assert.equal(ppkItemStatuses(facts({ orgInfo: { required: 9, missing: 0 } }))["1-1"], "done");
  assert.equal(ppkItemStatuses(facts({ orgInfo: { required: 9, missing: 3 } }))["1-1"], "started");
});

test("1.3: договор в перечне — заполнен; только файлы — начат", () => {
  assert.equal(ppkItemStatuses(facts({ contracts: { records: 1, files: 0 } }))["1-3"], "done");
  assert.equal(ppkItemStatuses(facts({ contracts: { records: 0, files: 2 } }))["1-3"], "started");
});

test("1.4: пропуски — начат, без пропусков — заполнен", () => {
  assert.equal(ppkItemStatuses(facts({ productionInfo: { exists: true, missing: 2 } }))["1-4"], "started");
  assert.equal(ppkItemStatuses(facts({ productionInfo: { exists: true, missing: 0 } }))["1-4"], "done");
});

test("2.1: скан своей политики заменяет текст", () => {
  assert.equal(ppkItemStatuses(facts({ folders: { "policy-scan": 1 } }))["2-1"], "done");
  const all = blocks("empty");
  all.policy = "started";
  assert.equal(ppkItemStatuses(facts({ blocks: all }))["2-1"], "started");
});

test("2.2–2.4: текст или скан — заполнен; прежние сканы группы — начат", () => {
  assert.equal(ppkItemStatuses(facts({ texts: { "text-team-regulation": true } }))["2-2"], "done");
  assert.equal(ppkItemStatuses(facts({ folders: { "team-leader-scan": 1 } }))["2-3"], "done");
  assert.equal(ppkItemStatuses(facts({ teamOrder: true }))["2-4"], "done");
  const legacy = ppkItemStatuses(facts({ folders: { "team-signed": 2 } }));
  assert.equal(legacy["2-2"], "started");
  assert.equal(legacy["2-4"], "started");
  assert.equal(legacy["2-3"], "empty");
  const team = blocks("empty");
  team.team = "done";
  assert.equal(ppkItemStatuses(facts({ blocks: team }))["2-2"], "started");
});

test("2.7 и 2.8 считаются по опасностям, тексты и таблицы — по записям", () => {
  const statuses = ppkItemStatuses(
    facts({ hazards: 3, texts: { "text-haccp-principles": true, "text-ccp-method": true }, prp: { "prp-medical": 4 } }),
  );
  assert.equal(statuses["2-7"], "done");
  assert.equal(statuses["2-8"], "done");
  assert.equal(statuses["1-8"], "done");
  assert.equal(statuses["2-9"], "done");
  assert.equal(statuses["1-9"], "empty");
  assert.equal(statuses["3-4"], "done");
  assert.equal(statuses["3-1"], "empty");
});

test("3.7: без утверждённой версии — пусто; часть подписей — начат; все — заполнен", () => {
  assert.equal(ppkItemStatuses(facts({ acquaintance: { available: false, acknowledged: 0, total: 5 } }))["3-7"], "empty");
  assert.equal(ppkItemStatuses(facts({ acquaintance: { available: true, acknowledged: 2, total: 5 } }))["3-7"], "started");
  assert.equal(ppkItemStatuses(facts({ acquaintance: { available: true, acknowledged: 5, total: 5 } }))["3-7"], "done");
});

test("подтягиваемые приложения: оборудование, журналы, график потоков", () => {
  const statuses = ppkItemStatuses(facts({ equipment: 4, journals: 12, folders: { "flow-schedule": 1 }, staff: 7 }));
  assert.equal(statuses["app-1"], "done");
  assert.equal(statuses["app-4"], "done");
  assert.equal(statuses["app-3"], "done");
  assert.equal(statuses["3-5"], "done");
});

const org = (patch: Partial<DocumentOrgBlock["org"]> = {}): DocumentOrgBlock["org"] => ({
  fullName: "ООО «Ромашка»",
  shortName: "ООО «Ромашка»",
  journalName: "ООО «Ромашка»",
  inn: "7701234567",
  kpp: "770101001",
  ogrn: "1027700000000",
  ogrnLabel: "ОГРН",
  legalAddress: "г. Москва, ул. Тверская, 1",
  address: "г. Москва, ул. Тверская, 1",
  phone: "+7 495 000-00-00",
  directorName: "Иванов И. И.",
  directorPost: "Генеральный директор",
  city: "Москва",
  ...patch,
});

test("1.1: обязательные сведения; у ИП КПП не нужен", () => {
  assert.deepEqual(missingOrgInfo(org()), []);
  assert.deepEqual(missingOrgInfo(org({ phone: null, kpp: "  " })), ["kpp", "phone"]);
  const ip = org({ inn: "770123456789", kpp: null, ogrnLabel: "ОГРНИП", ogrn: "304770000000000" });
  assert.deepEqual(missingOrgInfo(ip), []);
  assert.equal(requiredOrgInfo(ip).includes("kpp"), false);
  assert.equal(requiredOrgInfo(org()).length, 9);
});

test("1.4: подтянутые название и адрес, обязательные поля шаблона, вид деятельности из сферы", () => {
  const pulled = { objectName: "Кафе на Ленина", objectAddress: "ул. Ленина, 5", activity: "Кафе" };
  assert.deepEqual(missingProductionInfo(null, pulled), ["workingHours", "capacity", "waterSupply", "sewage"]);
  const full = { ...emptyProductionInfo(), workingHours: "10:00–22:00", capacity: "300 порций", waterSupply: "Централизованное", sewage: "Централизованное" };
  assert.deepEqual(missingProductionInfo(full, pulled), []);
  assert.deepEqual(missingProductionInfo(full, { objectName: null, objectAddress: "", activity: null }), [
    "objectName",
    "objectAddress",
    "activity",
  ]);
});
