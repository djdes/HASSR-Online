import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_VALUES,
  categoryForSphere,
  effectiveObjectCategory,
  normalizeObjectCategory,
  organizationRuleSpheres,
  resolveSphereForCategory,
  sphereForCategory,
} from "@/lib/object-categories";
import {
  isStarterJournalSet,
  mergedRulesFor,
  planObjectCategoryJournals,
  requiredCodesForSpheres,
} from "@/lib/object-category-journals";
import { ORG_SPHERES } from "@/lib/org-profile";
import { defaultDisabledCodesFor, requiredCodesFor, rulesFor } from "@/lib/sphere-journal-rules";

/**
 * Сферы объектов (владелец, 2026-11-23): «только 4 сферы: Общепит ХАССП,
 * Медицинские услуги, Услуги потребителям, Спорт и рекреация», «объекты
 * завязываем на категориях, у организации».
 */

const messages = (locale: string) =>
  JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")) as {
    common: { objectCategories: Record<string, string> };
  };

test("ровно четыре сферы объекта, подписи на трёх языках", () => {
  assert.deepEqual(OBJECT_CATEGORY_VALUES, ["food", "medical", "consumer", "sport"]);
  assert.deepEqual(
    OBJECT_CATEGORY_VALUES.map((value) => messages("ru").common.objectCategories[value]),
    ["Общепит ХАССП", "Медицинские услуги", "Услуги потребителям", "Спорт и рекреация"],
  );
  for (const locale of ["en", "uz"]) {
    for (const value of OBJECT_CATEGORY_VALUES) {
      assert.ok(messages(locale).common.objectCategories[value], `${locale}: ${value}`);
    }
  }
  assert.deepEqual(
    OBJECT_CATEGORIES.map((category) => category.sphere),
    ["restaurant", "medical", "beauty", "fitness"],
  );
});

test("каждая старая сфера организации показывается своей категорией; «Другое» — без", () => {
  for (const sphere of ORG_SPHERES) {
    const category = categoryForSphere(sphere.value);
    if (sphere.value === "other") assert.equal(category, null);
    else assert.ok(category && OBJECT_CATEGORY_VALUES.includes(category), sphere.value);
  }
  assert.equal(categoryForSphere("education"), "food");
  assert.equal(categoryForSphere("canteen"), "food");
  assert.equal(categoryForSphere("beauty"), "consumer");
  assert.equal(categoryForSphere("fitness"), "sport");
  assert.equal(categoryForSphere("medical"), "medical");
  assert.equal(categoryForSphere("meat"), "food", "старые значения внешнего API");
  assert.equal(normalizeObjectCategory(" Food "), "food");
  assert.equal(normalizeObjectCategory("restaurant"), null);
  assert.equal(normalizeObjectCategory(null), null);
});

test("выбор категории не переписывает точную сферу организации той же категории", () => {
  assert.equal(resolveSphereForCategory("education", "food"), "education", "школа остаётся школой");
  assert.equal(resolveSphereForCategory("education", "medical"), "medical");
  assert.equal(resolveSphereForCategory("other", "sport"), "fitness");
  assert.equal(sphereForCategory("consumer"), "beauty");
  assert.equal(effectiveObjectCategory(null, "canteen"), "food");
  assert.equal(effectiveObjectCategory("sport", "canteen"), "sport");
  assert.equal(effectiveObjectCategory(null, "other"), null);
});

test("сферы правил организации: основная + сферы объектов других категорий", () => {
  assert.deepEqual(organizationRuleSpheres("education", ["food", null]), ["education"]);
  assert.deepEqual(organizationRuleSpheres("education", ["food", "medical"]), ["education", "medical"]);
  assert.deepEqual(organizationRuleSpheres("other", ["sport"]), ["fitness"]);
  assert.deepEqual(organizationRuleSpheres("other", []), ["other"]);
  const merged = mergedRulesFor(["education", "medical"]);
  const codes = merged.electronicRequired.map((rule) => rule.code);
  assert.deepEqual(new Set(codes), new Set(requiredCodesForSpheres(["education", "medical"])));
  assert.equal(new Set(codes).size, codes.length, "без повторов");
  assert.equal(merged.intro, rulesFor("education").intro, "вступление — основной сферы");
  for (const code of merged.electronicRecommended) assert.ok(!codes.includes(code), `${code} и обязательный, и рекомендованный`);
  assert.equal(mergedRulesFor(["cafe"]), rulesFor("cafe"));
});

test("стартовый набор журналов: после регистрации — да, после ручной правки — нет", () => {
  assert.equal(isStarterJournalSet([], "other"), true);
  assert.equal(isStarterJournalSet(defaultDisabledCodesFor("other"), "other"), true);
  const oneEnabledByQr = defaultDisabledCodesFor("other").slice(1);
  assert.equal(isStarterJournalSet(oneEnabledByQr, "other"), true, "журнал из QR шаблона");
  const touched = defaultDisabledCodesFor("other").slice(3);
  assert.equal(isStarterJournalSet(touched, "other"), false);
  assert.equal(isStarterJournalSet([...defaultDisabledCodesFor("other"), "hygiene"], "other"), false);
});

test("первый объект новой организации: основная сфера и набор журналов — по сфере объекта", () => {
  const plan = planObjectCategoryJournals({
    organizationSphere: "other",
    organizationDisabled: defaultDisabledCodesFor("other"),
    category: "food",
    reason: "create",
    objectDisabled: null,
  });
  assert.equal(plan.organizationSphere, "restaurant");
  assert.deepEqual(plan.organizationDisabled, defaultDisabledCodesFor("restaurant"));
  assert.equal(plan.objectDisabled, null, "объект живёт набором организации");
});

test("объект основной категории у настроенной организации — журналы не трогаем", () => {
  const touched = defaultDisabledCodesFor("canteen").slice(4);
  const plan = planObjectCategoryJournals({
    organizationSphere: "canteen",
    organizationDisabled: touched,
    category: "food",
    reason: "create",
    objectDisabled: null,
  });
  assert.deepEqual(plan, { organizationSphere: null, organizationDisabled: null, objectDisabled: null });
});

test("объект другой категории получает свой набор журналов своей сферы", () => {
  const plan = planObjectCategoryJournals({
    organizationSphere: "cafe",
    organizationDisabled: [],
    category: "medical",
    reason: "create",
    objectDisabled: null,
  });
  assert.equal(plan.organizationSphere, null);
  assert.equal(plan.organizationDisabled, null);
  assert.deepEqual(plan.objectDisabled, defaultDisabledCodesFor("medical"));
});

test("смена сферы объекта только включает обязательные журналы новой сферы", () => {
  const required = requiredCodesFor("fitness");
  const ownDisabled = [...required, "some_other_journal"];
  const own = planObjectCategoryJournals({
    organizationSphere: "cafe",
    organizationDisabled: [],
    category: "sport",
    reason: "change",
    objectDisabled: ownDisabled,
  });
  assert.deepEqual(own.objectDisabled, ["some_other_journal"]);
  assert.equal(own.organizationDisabled, null);

  const inherited = planObjectCategoryJournals({
    organizationSphere: "cafe",
    organizationDisabled: [...requiredCodesFor("cafe"), "x"],
    category: "food",
    reason: "change",
    objectDisabled: null,
  });
  assert.deepEqual(inherited.organizationDisabled, ["x"], "объект без своего набора — набор организации");

  const nothing = planObjectCategoryJournals({
    organizationSphere: "cafe",
    organizationDisabled: ["x"],
    category: "food",
    reason: "change",
    objectDisabled: null,
  });
  assert.deepEqual(nothing, { organizationSphere: null, organizationDisabled: null, objectDisabled: null });
});
