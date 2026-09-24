import assert from "node:assert/strict";
import test from "node:test";

import { NICHES } from "@/content/niches";
import { ORG_SPHERES } from "@/lib/org-profile";
import { SPHERE_RULES } from "@/lib/sphere-journal-rules";
import {
  buildSpherePublicContent,
  publicNote,
} from "@/lib/sphere-public-content";

test("у каждой сферы страница получает журналы, приказы и чек-листы из правил", () => {
  for (const { value: sphere } of ORG_SPHERES) {
    const content = buildSpherePublicContent(sphere);
    const rules = SPHERE_RULES[sphere];
    assert.deepEqual(
      content.required.map((j) => j.code),
      rules.electronicRequired.map((r) => r.code),
      sphere,
    );
    assert.deepEqual(content.recommended.map((j) => j.code), rules.electronicRecommended, sphere);
    assert.equal(content.ordersRequired.length, rules.ordersRequired.length, sphere);
    assert.equal(content.ordersRecommended.length, rules.ordersRecommended.length, sphere);
    assert.equal(content.checklists.length, rules.checklistJournals.length, sphere);
    for (const journal of [...content.required, ...content.recommended]) {
      assert.notEqual(journal.name, journal.code, `${sphere}: нет названия у ${journal.code}`);
    }
    for (const checklist of content.checklists) {
      assert.ok(checklist.examples.length >= 2 && checklist.examples.length <= 3, checklist.code);
    }
  }
});

test("на публичной странице нет служебных пометок для юристов", () => {
  for (const { value: sphere } of ORG_SPHERES) {
    for (const journal of buildSpherePublicContent(sphere).required) {
      if (journal.note) assert.doesNotMatch(journal.note, /юр-?сверк|юрист/i, `${sphere}/${journal.code}`);
    }
  }
  assert.equal(publicNote("проверить формулировку у юриста"), null);
  assert.equal(
    publicNote("СП для торговых объектов — соблюдение условий хранения производителя; требует юр-сверки"),
    "СП для торговых объектов — соблюдение условий хранения производителя",
  );
  assert.equal(publicNote("СанПиН — ежедневно"), "СанПиН — ежедневно");
});

test("каждая ниша /dlya-* привязана к сфере, фитнес — к fitness", () => {
  const spheres = new Set(ORG_SPHERES.map((s) => s.value));
  for (const niche of Object.values(NICHES)) {
    assert.ok(spheres.has(niche.sphere), `${niche.slug}: неизвестная сфера ${niche.sphere}`);
  }
  assert.equal(NICHES["dlya-fitnes-centra"]?.sphere, "fitness");
  assert.equal(NICHES["dlya-salona-krasoty"]?.sphere, "beauty");
});

test("страница салона: стерилизация с основанием, приказы и чек-листы салона", () => {
  const content = buildSpherePublicContent("beauty");
  const sterilization = content.required.find((j) => j.code === "instrument_sterilization");
  assert.ok(sterilization, "нет журнала стерилизации");
  assert.equal(sterilization.href, "/journals-info/instrument_sterilization");
  assert.equal(sterilization.basisLabel, "Требование санитарных правил");
  assert.match(sterilization.law?.label ?? "", /3678-20/);
  assert.equal(sterilization.note, "СанПиН 2.1.3678-20 — требования к парикмахерским и салонам красоты");
  const waste = content.required.find((j) => j.code === "medical_waste_b");
  assert.ok(waste?.condition, "у отходов класса Б нет условия");
  assert.deepEqual(
    content.ordersRequired.map((o) => o.code),
    ["sanitary-responsible", "journals-intro", "ppk-approval", "disinfection"],
  );
  const cleaning = content.checklists.find((c) => c.code === "cleaning");
  assert.ok(cleaning, "нет чек-листа уборки");
  // Примеры — из набора салона, а не пищевого.
  assert.match(cleaning.examples.join(" "), /клиент/i);
  assert.doesNotMatch(cleaning.examples.join(" "), /кухн|солонк/i);
  const serialized = JSON.stringify(content);
  assert.doesNotMatch(serialized, /юр-?сверк|юрист/i);
});
