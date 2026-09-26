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

test("PATCH (окно на странице журнала): без входа — 401, сотруднику — 403, ничего не пишется", async () => {
  const { deps, writes, audits } = fakeDeps({ org_a: { journals: { cleaning: "Уборка" } } });
  const anonymous = await saveCustomNames(
    { actor: null, organizationId: null, body: { journals: { hygiene: "Гигиена" } }, mode: "merge" },
    deps
  );
  assert.equal(anonymous.status, 401);
  const staff = await saveCustomNames(
    { actor: cook, organizationId: "org_a", body: { journals: { hygiene: "Гигиена" } }, mode: "merge" },
    deps
  );
  assert.equal(staff.status, 403);
  assert.equal(staff.body.error, "Это действие доступно руководителю");
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});

test("PATCH: меняет только присланный журнал, остальные названия остаются, аудит — про него", async () => {
  const { deps, writes, audits, stored } = fakeDeps({
    org_a: { journals: { cleaning: "Уборка" }, sections: { reports: "Выгрузки" } },
    org_b: { journals: { hygiene: "Чужое название" } },
  });
  const result = await saveCustomNames(
    {
      actor: manager,
      organizationId: "org_a",
      body: { journals: { hygiene: "  Гигиена   персонала " } },
      mode: "merge",
    },
    deps
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.changed, 1);
  assert.deepEqual(result.body.names, {
    journals: { cleaning: "Уборка", hygiene: "Гигиена персонала" },
    sections: { reports: "Выгрузки" },
  });
  assert.deepEqual(writes, [
    {
      organizationId: "org_a",
      names: {
        journals: { cleaning: "Уборка", hygiene: "Гигиена персонала" },
        sections: { reports: "Выгрузки" },
      },
    },
  ]);
  assert.deepEqual(stored.org_b, { journals: { hygiene: "Чужое название" } });
  // Та же запись в журнал действий, что у страницы «Названия».
  assert.deepEqual(audits, [
    {
      organizationId: "org_a",
      details: {
        count: 1,
        "Журнал «Гигиенический журнал (сотрудники)»": { from: "стандартное", to: "Гигиена персонала" },
      },
    },
  ]);
});

test("PATCH: пустое название — «Вернуть стандартное» только у этого журнала", async () => {
  const { deps, writes, audits } = fakeDeps({
    org_a: { journals: { hygiene: "Гигиена персонала", cleaning: "Уборка" }, sections: {} },
  });
  const result = await saveCustomNames(
    { actor: manager, organizationId: "org_a", body: { journals: { hygiene: "" } }, mode: "merge" },
    deps
  );
  assert.equal(result.status, 200);
  assert.deepEqual(writes[0].names, { journals: { cleaning: "Уборка" }, sections: {} });
  assert.deepEqual(audits[0].details, {
    count: 1,
    "Журнал «Гигиенический журнал (сотрудники)»": { from: "Гигиена персонала", to: "стандартное" },
  });
});

test("PATCH: те же проверки — 2–80 символов и без повторов с другими журналами", async () => {
  const { deps, writes, audits } = fakeDeps({ org_a: { journals: { cleaning: "Уборка" } } });
  const short = await saveCustomNames(
    { actor: manager, organizationId: "org_a", body: { journals: { hygiene: "Г" } }, mode: "merge" },
    deps
  );
  assert.equal(short.status, 400);
  assert.deepEqual(short.body.errors, [
    { kind: "journal", key: "hygiene", message: "От 2 до 80 символов" },
  ]);

  // Повтор со своим названием другого журнала, сохранённым раньше. Текст
  // ответа — про журнал, который переименовывают.
  const taken = await saveCustomNames(
    { actor: manager, organizationId: "org_a", body: { journals: { hygiene: "уборка" } }, mode: "merge" },
    deps
  );
  assert.equal(taken.status, 400);
  assert.equal(
    taken.body.error,
    "Журнал «Гигиенический журнал (сотрудники)»: так уже назван журнал «Журнал уборки»"
  );
  assert.deepEqual((taken.body.errors as Array<{ key: string }>)[0], {
    kind: "journal",
    key: "hygiene",
    message: "Так уже назван журнал «Журнал уборки»",
  });

  // Повтор с официальным названием другого журнала (у гигиенического
  // своего названия нет — его официальное занято).
  const official = await saveCustomNames(
    {
      actor: manager,
      organizationId: "org_a",
      body: { journals: { cleaning: "гигиенический журнал (сотрудники)" } },
      mode: "merge",
    },
    deps
  );
  assert.equal(official.status, 400);
  assert.equal(
    official.body.error,
    "Журнал «Журнал уборки»: так называется журнал «Гигиенический журнал (сотрудники)»"
  );

  const badShape = await saveCustomNames(
    { actor: manager, organizationId: "org_a", body: { journals: "Гигиена" }, mode: "merge" },
    deps
  );
  assert.equal(badShape.status, 400);
  assert.equal(badShape.body.error, "Неверный формат названий");
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});
