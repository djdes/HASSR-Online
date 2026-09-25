import assert from "node:assert/strict";
import test from "node:test";

import type { CustomNames } from "@/lib/custom-names";
import { saveCustomNames, type SaveCustomNamesDeps } from "@/lib/custom-names-save";

const JOURNALS = [
  { code: "hygiene", name: "Гигиенический журнал (сотрудники)" },
  { code: "cleaning", name: "Журнал уборки" },
];

const manager = { role: "manager", isRoot: false };
const cook = { role: "cook", isRoot: false };

/** Две организации в «базе»: сохранение одной не должно трогать другую. */
function fakeDeps(stored: Record<string, unknown>) {
  const writes: Array<{ organizationId: string; names: CustomNames }> = [];
  const audits: Array<{ organizationId: string; details: Record<string, unknown> }> = [];
  const deps: SaveCustomNamesDeps = {
    loadStored: async (organizationId) => stored[organizationId] ?? {},
    listJournals: async () => JOURNALS,
    store: async (organizationId, names) => {
      writes.push({ organizationId, names });
      stored[organizationId] = names;
    },
    audit: async (entry) => {
      audits.push(entry);
    },
  };
  return { deps, writes, audits, stored };
}

test("API: без входа — 401, сотруднику — 403, ничего не пишется", async () => {
  const { deps, writes, audits } = fakeDeps({});
  const anonymous = await saveCustomNames({ actor: null, organizationId: null, body: {} }, deps);
  assert.equal(anonymous.status, 401);
  const staff = await saveCustomNames(
    { actor: cook, organizationId: "org_a", body: { journals: { hygiene: "Гигиена" } } },
    deps
  );
  assert.equal(staff.status, 403);
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});

test("API: неверное название — 400 с полем и понятным текстом, ничего не пишется", async () => {
  const { deps, writes, audits } = fakeDeps({});
  const result = await saveCustomNames(
    { actor: manager, organizationId: "org_a", body: { journals: { hygiene: "Г" } } },
    deps
  );
  assert.equal(result.status, 400);
  assert.match(String(result.body.error), /Гигиенический журнал \(сотрудники\)»: от 2 до 80 символов/);
  assert.deepEqual(result.body.errors, [
    { kind: "journal", key: "hygiene", message: "От 2 до 80 символов" },
  ]);
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});

test("API: сохраняет свои названия только своей организации и пишет аудит «было → стало»", async () => {
  const { deps, writes, audits, stored } = fakeDeps({
    org_a: { journals: { cleaning: "Уборка" } },
    org_b: { journals: { hygiene: "Чужое название" } },
  });
  const result = await saveCustomNames(
    {
      actor: manager,
      organizationId: "org_a",
      body: {
        journals: { hygiene: "  Гигиена   персонала ", cleaning: "" },
        sections: { journals: "Документы" },
      },
    },
    deps
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.names, {
    journals: { hygiene: "Гигиена персонала" },
    sections: { journals: "Документы" },
  });
  assert.equal(result.body.changed, 3);
  assert.deepEqual(writes, [
    {
      organizationId: "org_a",
      names: { journals: { hygiene: "Гигиена персонала" }, sections: { journals: "Документы" } },
    },
  ]);
  // Другая организация не тронута.
  assert.deepEqual(stored.org_b, { journals: { hygiene: "Чужое название" } });

  assert.equal(audits.length, 1);
  assert.equal(audits[0].organizationId, "org_a");
  assert.deepEqual(audits[0].details, {
    count: 3,
    "Раздел «Журналы»": { from: "стандартное", to: "Документы" },
    "Журнал «Журнал уборки»": { from: "Уборка", to: "стандартное" },
    "Журнал «Гигиенический журнал (сотрудники)»": { from: "стандартное", to: "Гигиена персонала" },
  });
});

test("API: повторное сохранение без изменений — без записи и без аудита", async () => {
  const { deps, writes, audits } = fakeDeps({
    org_a: { journals: { hygiene: "Гигиена персонала" }, sections: {} },
  });
  const result = await saveCustomNames(
    {
      actor: manager,
      organizationId: "org_a",
      body: { journals: { hygiene: "Гигиена персонала", cleaning: "" }, sections: { journals: "" } },
    },
    deps
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.changed, 0);
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});

test("API: «Вернуть стандартное» — пустое поле убирает своё название", async () => {
  const { deps, writes } = fakeDeps({
    org_a: { journals: { hygiene: "Гигиена персонала" }, sections: { reports: "Выгрузки" } },
  });
  const result = await saveCustomNames(
    {
      actor: { role: "owner" },
      organizationId: "org_a",
      body: { journals: { hygiene: "" }, sections: { reports: "   " } },
    },
    deps
  );
  assert.equal(result.status, 200);
  assert.deepEqual(writes[0].names, { journals: {}, sections: {} });
});
