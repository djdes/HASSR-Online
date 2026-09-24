/**
 * Правила «сфера → журналы» — юридический контент, который правят руками.
 * Тест ловит опечатку в коде журнала: она не сломает сборку, но тихо
 * выкинет обязательный журнал из набора новой организации.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { defaultChecklistFor } from "@/lib/checklist-defaults";
import { JOURNAL_INFO } from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG, JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { REGISTER_DOCUMENT_TEMPLATE_CODES } from "@/lib/register-document";
import { ALL_JOURNAL_CODES } from "@/lib/onboarding-presets";
import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { SPHERE_POSITION_SUGGESTIONS } from "@/lib/sphere-positions";
import {
  PAPER_JOURNALS,
  SPHERE_RULES,
  defaultDisabledCodesFor,
  paperJournalsFor,
  requiredCodesFor,
} from "@/lib/sphere-journal-rules";

const spheres = ORG_SPHERES.map((item) => item.value as OrgSphere);
const catalogCodes = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.code));
const paperIds = new Set<string>(PAPER_JOURNALS.map((journal) => journal.id));

test("у каждой сферы из словаря есть правила", () => {
  for (const sphere of spheres) {
    assert.ok(SPHERE_RULES[sphere], `нет правил для сферы ${sphere}`);
  }
});

test("все коды журналов существуют в каталоге", () => {
  for (const sphere of spheres) {
    const rules = SPHERE_RULES[sphere];
    for (const rule of rules.electronicRequired) {
      assert.ok(
        catalogCodes.has(rule.code),
        `${sphere}: обязательный код ${rule.code} отсутствует в каталоге`,
      );
    }
    for (const code of rules.electronicRecommended) {
      assert.ok(
        catalogCodes.has(code),
        `${sphere}: рекомендованный код ${code} отсутствует в каталоге`,
      );
    }
  }
});

test("бумажные журналы ссылаются на существующие бланки", () => {
  for (const sphere of spheres) {
    for (const id of SPHERE_RULES[sphere].paperRequired) {
      assert.ok(paperIds.has(id), `${sphere}: нет бланка ${id}`);
    }
    assert.equal(
      paperJournalsFor(sphere).length,
      SPHERE_RULES[sphere].paperRequired.length,
    );
  }
});

test("у каждой сферы есть хотя бы один обязательный журнал", () => {
  for (const sphere of spheres) {
    assert.ok(
      requiredCodesFor(sphere).length > 0,
      `${sphere}: пустой обязательный набор`,
    );
  }
});

test("выключаем всё, кроме обязательного", () => {
  for (const sphere of spheres) {
    const required = new Set(requiredCodesFor(sphere));
    const disabled = new Set(defaultDisabledCodesFor(sphere));
    for (const code of ALL_JOURNAL_CODES) {
      assert.equal(
        disabled.has(code),
        !required.has(code),
        `${sphere}: код ${code} попал не в ту группу`,
      );
    }
  }
});

test("журнал здоровья выключен по умолчанию и не рекомендуется ни одной сфере", () => {
  for (const sphere of spheres) {
    assert.ok(
      defaultDisabledCodesFor(sphere).includes("health_check"),
      `${sphere}: health_check должен быть выключен по умолчанию`,
    );
    assert.ok(
      !SPHERE_RULES[sphere].electronicRecommended.includes("health_check"),
      `${sphere}: health_check не должен быть в рекомендованных`,
    );
    assert.ok(
      !requiredCodesFor(sphere).includes("health_check"),
      `${sphere}: health_check не должен быть обязательным`,
    );
  }
});

test("у бумажного бланка есть закон, штраф и колонки", () => {
  for (const journal of PAPER_JOURNALS) {
    assert.ok(journal.law.url.startsWith("https://"), journal.id);
    assert.ok(journal.fineHint.length > 0, journal.id);
    assert.ok(journal.columns.length >= 3, journal.id);
  }
});

test("обязательные и рекомендованные наборы не пересекаются", () => {
  for (const sphere of spheres) {
    const rules = SPHERE_RULES[sphere];
    const required = new Set(rules.electronicRequired.map((rule) => rule.code));
    for (const code of rules.electronicRecommended) {
      assert.ok(
        !required.has(code),
        `${sphere}: ${code} и в обязательных, и в рекомендованных`,
      );
    }
  }
});

test("у каждой сферы есть бумажные бланки", () => {
  for (const sphere of spheres) {
    assert.ok(
      SPHERE_RULES[sphere].paperRequired.length > 0,
      `${sphere}: пустой список бланков`,
    );
  }
});

test("у каждой сферы есть подсказки должностей", () => {
  for (const sphere of spheres) {
    const positions = SPHERE_POSITION_SUGGESTIONS[sphere];
    assert.ok(positions, `${sphere}: нет подсказок должностей`);
    assert.ok(positions.management.length > 0, `${sphere}: пустое руководство`);
    assert.ok(positions.staff.length > 0, `${sphere}: пустые сотрудники`);
  }
});

test("условный обязательный журнал объясняет условие и имеет основание", () => {
  for (const sphere of spheres) {
    for (const rule of SPHERE_RULES[sphere].electronicRequired) {
      if (!rule.condition) continue;
      assert.ok(
        rule.condition.length > 10,
        `${sphere}: у ${rule.code} условие слишком короткое`,
      );
      assert.ok(rule.basis, `${sphere}: у ${rule.code} нет основания`);
    }
  }
});

test("вступление ссылается на действующий СанПиН", () => {
  for (const sphere of spheres) {
    assert.match(
      SPHERE_RULES[sphere].intro,
      /4282-26/,
      `${sphere}: во вступлении не действующий СанПиН`,
    );
  }
});

const orderCodes = new Set(ORDER_TEMPLATES.map((order) => order.code));

/** Журналы, добавленные в сентябре 2026 как табличные реестры. */
const NEW_REGISTER_CODES = [
  "daily_samples",
  "vitaminization",
  "ration_control",
  "transport_temperature",
  "tableware_breakage",
  "pool_water_control",
  "inventory_condition",
  "instrument_sterilization",
  "medical_waste_b",
  "batch_release",
];

test("сфера «Фитнес» есть в словаре и в правилах", () => {
  assert.ok(spheres.includes("fitness"));
  const rules = SPHERE_RULES.fitness;
  assert.deepEqual(requiredCodesFor("fitness").sort(), [
    "cold_equipment_control",
    "hygiene",
    "pest_control",
    "pool_water_control",
  ]);
  // Пищевые журналы у фитнеса — только при баре: условие обязательно.
  for (const code of ["hygiene", "cold_equipment_control", "pool_water_control"]) {
    const rule = rules.electronicRequired.find((item) => item.code === code);
    assert.ok(rule?.condition, `fitness: у ${code} нет условия`);
  }
});

test("сфера «Салон красоты» есть в словаре и в правилах", () => {
  assert.ok(spheres.includes("beauty"));
  const rules = SPHERE_RULES.beauty;
  assert.deepEqual(requiredCodesFor("beauty").sort(), [
    "disinfectant_usage",
    "general_cleaning",
    "instrument_sterilization",
    "medical_waste_b",
  ]);
  // Отходы класса Б — только при косметологии и инъекциях.
  const waste = rules.electronicRequired.find((item) => item.code === "medical_waste_b");
  assert.ok(waste?.condition, "beauty: у medical_waste_b нет условия");
  // Пищевых журналов у салона нет ни в обязательных, ни в рекомендуемых.
  const all = [...requiredCodesFor("beauty"), ...rules.electronicRecommended];
  for (const code of ["hygiene", "cold_equipment_control", "fryer_oil", "finished_product"]) {
    assert.ok(!all.includes(code), `beauty: пищевой журнал ${code}`);
  }
  assert.deepEqual(rules.ordersRequired, [
    "sanitary-responsible",
    "journals-intro",
    "ppk-approval",
    "disinfection",
  ]);
  assert.ok(rules.checklistJournals.includes("instrument_sterilization"));
  // Новая организация салона: обязательные включены, рекомендуемые выключены.
  const disabled = new Set(defaultDisabledCodesFor("beauty"));
  for (const code of requiredCodesFor("beauty")) assert.ok(!disabled.has(code), code);
  for (const code of rules.electronicRecommended) assert.ok(disabled.has(code), code);
});

test("новые журналы второй волны разнесены по сферам", () => {
  const recommended = (sphere: OrgSphere) => SPHERE_RULES[sphere].electronicRecommended;
  for (const sphere of ["restaurant", "cafe", "canteen", "fastfood", "catering", "bakery", "production"] as const) {
    assert.ok(recommended(sphere).includes("inventory_condition"), `${sphere}: inventory_condition`);
  }
  for (const sphere of ["production", "bakery"] as const) {
    assert.ok(recommended(sphere).includes("batch_release"), `${sphere}: batch_release`);
  }
  assert.ok(requiredCodesFor("beauty").includes("instrument_sterilization"));
  assert.ok(requiredCodesFor("beauty").includes("medical_waste_b"));
  assert.ok(recommended("medical").includes("instrument_sterilization"));
  assert.ok(recommended("medical").includes("medical_waste_b"));
});

test("приказы сфер существуют в каталоге приказов", () => {
  for (const sphere of spheres) {
    const rules = SPHERE_RULES[sphere];
    assert.ok(rules.ordersRequired.length > 0, `${sphere}: нет обязательных приказов`);
    assert.ok(rules.ordersRecommended.length > 0, `${sphere}: нет рекомендуемых приказов`);
    for (const code of [...rules.ordersRequired, ...rules.ordersRecommended]) {
      assert.ok(orderCodes.has(code), `${sphere}: приказа ${code} нет в ORDER_TEMPLATES`);
    }
    const required = new Set(rules.ordersRequired);
    for (const code of rules.ordersRecommended) {
      assert.ok(!required.has(code), `${sphere}: приказ ${code} и обязателен, и рекомендован`);
    }
  }
});

test("детским и медицинским организациям обязателен приказ о суточных пробах", () => {
  for (const sphere of ["education", "medical"] as const) {
    assert.ok(SPHERE_RULES[sphere].ordersRequired.includes("daily-samples"), sphere);
    assert.ok(requiredCodesFor(sphere).includes("daily_samples"), sphere);
    assert.ok(requiredCodesFor(sphere).includes("vitaminization"), sphere);
  }
});

test("у каждой сферы есть журналы для чек-листов, и у каждого — типовые пункты", () => {
  for (const sphere of spheres) {
    const codes = SPHERE_RULES[sphere].checklistJournals;
    assert.ok(codes.length > 0, `${sphere}: нет журналов для чек-листов`);
    for (const code of codes) {
      assert.ok(catalogCodes.has(code), `${sphere}: чек-лист для ${code}, которого нет в каталоге`);
      assert.ok(defaultChecklistFor(code).length > 0, `${sphere}: у ${code} нет типовых пунктов`);
    }
  }
});

test("каждый журнал каталога (кроме журнала здоровья) нужен хотя бы одной сфере", () => {
  const used = new Set<string>();
  for (const sphere of spheres) {
    for (const code of requiredCodesFor(sphere)) used.add(code);
    for (const code of SPHERE_RULES[sphere].electronicRecommended) used.add(code);
  }
  for (const code of catalogCodes) {
    if (code === "health_check") continue;
    assert.ok(used.has(code), `журнал ${code} не отнесён ни к одной сфере`);
  }
});

test("новые журналы — табличные реестры, есть в наборе кодов и в публичном описании", () => {
  const registerCodes = new Set<string>(REGISTER_DOCUMENT_TEMPLATE_CODES);
  for (const code of NEW_REGISTER_CODES) {
    assert.ok(catalogCodes.has(code), `${code}: нет в каталоге`);
    assert.ok(registerCodes.has(code), `${code}: нет в REGISTER_DOCUMENT_TEMPLATE_CODES`);
    assert.ok(ALL_JOURNAL_CODES.includes(code), `${code}: нет в ALL_JOURNAL_CODES`);
    assert.ok(JOURNAL_INFO[code], `${code}: нет в JOURNAL_INFO`);
  }
});

test("каталог и список кодов онбординга совпадают, число журналов — из каталога", () => {
  assert.deepEqual([...ALL_JOURNAL_CODES].sort(), [...catalogCodes].sort());
  assert.equal(JOURNALS_TOTAL, ACTIVE_JOURNAL_CATALOG.length);
});
