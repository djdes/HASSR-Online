import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  ORG_TEMPLATES,
  ZONE_CATALOG,
  ZONE_JOURNALS,
  customizeTemplate,
  defaultQuickSetupAnswers,
  getOrgTemplate,
  isKnownZone,
  plannedDisabledJournals,
  zoneOptions,
  type QuickSetupAnswers,
} from "@/lib/onboarding-templates";

/**
 * «Настройка за 3 минуты» (спека quick-setup-3-minutes-2026-11-21): вид
 * деятельности + пять ответов → шаблон под заведение.
 */

const ALL_CODES: string[] = ACTIVE_JOURNAL_CATALOG.map((item) => item.code);
const EQUIPMENT_TYPES = ["refrigerator", "freezer", "oven", "dishwasher", "scale", "thermometer", "sensor", "fryer", "uv_lamp", "other"];

const cafe = getOrgTemplate("cafe-small")!;
const medical = getOrgTemplate("medical")!;
const hotel = getOrgTemplate("hotel")!;

test("семь видов, у каждого — журналы из каталога и типы оборудования из справочника", () => {
  assert.deepEqual(ORG_TEMPLATES.map((item) => item.kind), ["stand", "cafe-small", "restaurant", "school", "production", "medical", "hotel"]);
  for (const template of ORG_TEMPLATES) {
    for (const code of template.enabledJournals ?? []) assert.ok(ALL_CODES.includes(code), `${template.kind}: нет журнала ${code}`);
    for (const item of template.equipment) assert.ok(EQUIPMENT_TYPES.includes(item.type), `${template.kind}: «${item.name}» — тип ${item.type}`);
    assert.ok(template.areas.length > 0 && template.positions.length > 0);
  }
  for (const zone of Object.keys(ZONE_JOURNALS)) assert.ok(ZONE_CATALOG.some((item) => item.name === zone), zone);
  for (const code of Object.values(ZONE_JOURNALS)) assert.ok(ALL_CODES.includes(code), code);
});

test("ответы по умолчанию — как в шаблоне, и шаблон без изменений даёт те же числа", () => {
  const answers = defaultQuickSetupAnswers(cafe);
  assert.deepEqual(answers, { fridges: 3, freezers: 1, uvLamps: 1, fryer: true, zones: cafe.areas.map((area) => area.name) });
  const plan = customizeTemplate(cafe, answers);
  assert.equal(plan.template.equipment.length, cafe.equipment.length);
  assert.deepEqual(plan.template.areas.map((area) => area.name), cafe.areas.map((area) => area.name));
});

test("числа → оборудование: имена шаблона, дальше «№k»; ноль — такого оборудования нет", () => {
  const answers: QuickSetupAnswers = { ...defaultQuickSetupAnswers(cafe), fridges: 5, freezers: 0, uvLamps: 3 };
  const names = customizeTemplate(cafe, answers).template.equipment.map((item) => item.name);
  assert.deepEqual(names.filter((name) => name.startsWith("Холодильник")), ["Холодильник №1 (мясо)", "Холодильник №2 (молочка)", "Холодильник №3 (овощи)", "Холодильник №4", "Холодильник №5"]);
  assert.ok(!names.some((name) => /Морозил/i.test(name)), "морозильников нет");
  assert.deepEqual(names.filter((name) => name.startsWith("УФ")), ["УФ-лампа кухня", "УФ-лампа №2", "УФ-лампа №3"]);
  const fewer = customizeTemplate(cafe, { ...answers, fridges: 1 }).template.equipment.filter((item) => item.type === "refrigerator");
  assert.deepEqual(fewer.map((item) => item.name), ["Холодильник №1 (мясо)"]);
  const generated = customizeTemplate(medical, { ...defaultQuickSetupAnswers(medical), fridges: 2 }).template.equipment.find((item) => item.name === "Холодильник №2");
  assert.deepEqual({ type: generated?.type, tempMin: generated?.tempMin, tempMax: generated?.tempMax }, { type: "refrigerator", tempMin: 2, tempMax: 6 });
});

test("фритюр по ответу: нет — убираем; есть, а в шаблоне нет — добавляем «Фритюр»", () => {
  const noFryer = customizeTemplate(cafe, { ...defaultQuickSetupAnswers(cafe), fryer: false });
  assert.ok(!noFryer.template.equipment.some((item) => item.type === "fryer"));
  assert.ok(noFryer.disable.includes("fryer_oil"));
  const medicalFryer = customizeTemplate(medical, { ...defaultQuickSetupAnswers(medical), fryer: true });
  assert.deepEqual(medicalFryer.template.equipment.filter((item) => item.type === "fryer").map((item) => item.name), ["Фритюр"]);
  assert.ok(medicalFryer.template.enabledJournals?.includes("fryer_oil"));
});

test("помещения: только отмеченные и допустимые; чужое название не проходит", () => {
  const zones = ["Горячий цех", "Мойка", "Бассейн", "Подвал без названия"];
  const plan = customizeTemplate(hotel, { ...defaultQuickSetupAnswers(hotel), zones });
  assert.deepEqual(plan.template.areas.map((area) => area.name), ["Горячий цех", "Мойка", "Бассейн"]);
  assert.equal(isKnownZone(hotel, "Подвал без названия"), false);
  assert.equal(isKnownZone(hotel, "Бассейн"), true);
  assert.ok(zoneOptions(hotel).some((zone) => zone.name === "Бассейн"), "бассейн предлагается отелю");
  assert.ok(!zoneOptions(cafe).some((zone) => zone.name === "Бассейн"), "кафе бассейн не предлагается");
});

test("оборудование — по помещениям: холод на склад/в камеру, УФ по цехам по кругу, фритюр в горячий цех", () => {
  const plan = customizeTemplate(cafe, { ...defaultQuickSetupAnswers(cafe), uvLamps: 3 });
  const place = (name: string) => plan.template.equipment.find((item) => item.name === name)?.areaName;
  assert.equal(place("Холодильник №1 (мясо)"), "Холодильная камера");
  assert.equal(place("Морозильная камера"), "Холодильная камера");
  assert.equal(place("Фритюр"), "Горячий цех");
  assert.deepEqual(
    plan.template.equipment.filter((item) => item.type === "uv_lamp").map((item) => item.areaName),
    ["Горячий цех", "Холодный цех", "Горячий цех"],
  );
  const clinic = customizeTemplate(medical, defaultQuickSetupAnswers(medical)).template.equipment;
  assert.equal(clinic.find((item) => item.type === "refrigerator")?.areaName, "Склад");
  assert.notEqual(clinic.find((item) => item.type === "uv_lamp")?.areaName, "Склад", "УФ-облучатель — в кабинеты, не на склад");
});

test("журналы по ответам: бассейн, УФ, холод, стерилизационная и отходы", () => {
  const withPool = customizeTemplate(hotel, { ...defaultQuickSetupAnswers(hotel), zones: [...hotel.areas.map((area) => area.name), "Бассейн"] });
  assert.ok(withPool.template.enabledJournals?.includes("pool_water_control"));
  const withoutPool = customizeTemplate(hotel, defaultQuickSetupAnswers(hotel));
  assert.ok(!withoutPool.template.enabledJournals?.includes("pool_water_control"));
  const noUv = customizeTemplate(hotel, { ...defaultQuickSetupAnswers(hotel), uvLamps: 0 });
  assert.ok(!noUv.template.enabledJournals?.includes("uv_lamp_runtime"));
  const noCold = customizeTemplate(hotel, { ...defaultQuickSetupAnswers(hotel), fridges: 0, freezers: 0 });
  assert.ok(!noCold.template.enabledJournals?.includes("cold_equipment_control"));
  const clinic = customizeTemplate(medical, { ...defaultQuickSetupAnswers(medical), zones: ["Процедурный кабинет", "Склад"] });
  assert.ok(!clinic.template.enabledJournals?.includes("instrument_sterilization"), "нет стерилизационной — нет журнала");
  assert.ok(!clinic.template.enabledJournals?.includes("medical_waste_b"));
});

test("план журналов: явный набор шаблона; «все журналы» — набор организации с поправками ответов", () => {
  const hotelPlan = customizeTemplate(hotel, defaultQuickSetupAnswers(hotel));
  const disabled = plannedDisabledJournals(hotelPlan, ALL_CODES, ["hygiene"]) ?? [];
  assert.ok(!disabled.includes("hygiene"), "явный набор отеля включает гигиенический");
  assert.ok(disabled.includes("pool_water_control"));

  const cafePlan = customizeTemplate(cafe, { ...defaultQuickSetupAnswers(cafe), fryer: false });
  const cafeDisabled = plannedDisabledJournals(cafePlan, ALL_CODES, ["audit_plan", "nonexistent_code"]) ?? [];
  assert.ok(cafeDisabled.includes("audit_plan"), "ручной выбор организации сохранён");
  assert.ok(cafeDisabled.includes("fryer_oil"), "нет фритюрницы — журнал выключен");
  assert.ok(!cafeDisabled.includes("nonexistent_code"));
  assert.ok(!cafeDisabled.includes("uv_lamp_runtime"), "УФ-лампа есть — журнал включён");

  assert.equal(plannedDisabledJournals(customizeTemplate(cafe), ALL_CODES, ["audit_plan"]), null, "без ответов набор «все» не трогаем");
});

test("тексты мастера и всех видов — на ru, en, uz", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const quick = (await loadMessages(locale)).settingsUi.quickSetup;
    for (const template of ORG_TEMPLATES) {
      const texts = quick.kinds[template.kind as keyof typeof quick.kinds];
      assert.ok(texts?.label && texts.description && texts.staffSize, `${locale}: ${template.kind}`);
    }
    for (const key of ["fridges", "freezers", "uvLamps", "fryer", "zones", "summary", "apply", "doneTitle", "nextQr", "nextStaff", "nextJournals"] as const) {
      assert.ok(quick[key].trim(), `${locale}: ${key}`);
    }
    assert.ok((await loadMessages(locale)).settingsUi.onboardingPage.quickSetupTitle.trim());
  }
});

test("API: ответы проверяются zod и списком помещений; мастер считает итог той же функцией", () => {
  const route = readFileSync(new URL("../app/api/settings/onboarding-template/route.ts", import.meta.url), "utf8");
  assert.match(route, /answersSchema\.safeParse\(rawAnswers\)/);
  assert.match(route, /isKnownZone\(base, name\)/);
  assert.match(route, /customizeTemplate\(base, answers\)/);
  assert.match(route, /plannedDisabledJournals\(plan,/);
  assert.ok(route.indexOf("checkJournalLimit") < route.indexOf("db.jobPosition.findMany"), "лимит тарифа — до записей");
  const client = readFileSync(new URL("../components/settings/onboarding-template-client.tsx", import.meta.url), "utf8");
  assert.match(client, /customizeTemplate\(template, answers\)/);
  assert.match(client, /href: "\/settings\/qr-posters"/);
  const onboarding = readFileSync(new URL("../app/(dashboard)/settings/onboarding/page.tsx", import.meta.url), "utf8");
  assert.match(onboarding, /!status\.coreComplete \? \(\s*<Link\s+href="\/settings\/onboarding-template"/);
});
