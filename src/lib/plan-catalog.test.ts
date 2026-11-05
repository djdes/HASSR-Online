import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CARD_POINTS,
  COMPARISON_GROUPS,
  FREE_PLAN_NOTE,
  FREE_PLAN_TITLE,
  FREE_TIER_SHORT,
  PAID_SEATS_LABEL,
  PAID_TIER_SUMMARY,
  POINTS_DISCOUNT_LINE,
  POINTS_NOTE,
  TIER_NAMES,
  VIP_HOTLINE_HOURS,
  employeesGenitiveLabel,
  employeesLabel,
  pricesFromLine,
  tierIdForPlan,
} from "@/lib/plan-catalog";
import { DEFAULT_PLAN_RATES, PAID_TIERS, PLAN_FEATURES, POINTS_DISCOUNT_STEPS, TIER_IDS, entitlementsFor } from "@/lib/tariff-plans";
import ru from "@/i18n/messages/ru.json";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { COMPARISONS } from "@/content/comparisons";
import { WESETUP_BOT_PROFILE as BOT_PROFILE } from "@/lib/bot/setup";

describe("тарифы 2026-11-05: Бесплатный 14 дней, Стандарт, Премиум, ВИП", () => {
  it("склонения: именительный и родительный", () => {
    assert.equal(employeesLabel(1), "1 сотрудник");
    assert.equal(employeesLabel(3), "3 сотрудника");
    assert.equal(employeesLabel(25), "25 сотрудников");
    assert.equal(employeesLabel(21), "21 сотрудник");
    assert.equal(employeesGenitiveLabel(1), "1 сотрудника");
    assert.equal(employeesGenitiveLabel(25), "25 сотрудников");
  });

  it("фразы собраны из констант", () => {
    assert.equal(FREE_TIER_SHORT, "14 дней бесплатно");
    assert.equal(FREE_PLAN_TITLE, "Бесплатный тариф — 14 дней без ограничений");
    assert.match(FREE_PLAN_NOTE, /^14 дней — все журналы, сотрудники и точки без ограничений, без карты\. Дальше бесплатно — 1 сотрудник и 1 журнал\.$/);
    assert.equal(PAID_SEATS_LABEL, "до 25 сотрудников на точку");
    assert.equal(
      POINTS_DISCOUNT_LINE,
      "от 5 точек — 5 %, от 10 — 10 %, от 15 — 20 %, от 35 — 25 %, от 50 — индивидуальное предложение"
    );
    assert.equal(POINTS_NOTE, `Каждая точка — как ещё один тариф; скидка на все точки: ${POINTS_DISCOUNT_LINE}.`);
    assert.match(
      pricesFromLine(DEFAULT_PLAN_RATES),
      /^«Стандарт» — от 1\s990 ₽\/мес, «Премиум» — от 3\s990 ₽\/мес, «ВИП» — от 8\s990 ₽\/мес$/
    );
    assert.equal(TIER_NAMES.vip, "ВИП");
    assert.equal(VIP_HOTLINE_HOURS, 10);
    for (const tier of PAID_TIERS) assert.ok(PAID_TIER_SUMMARY[tier], tier);
    assert.match(PAID_TIER_SUMMARY.premium, /электронная ППК/);
    assert.match(PAID_TIER_SUMMARY.vip, /всё из «Премиума», горячая линия \(до 10 часов в месяц\), расширенный банк данных и личный консультант/);
  });

  it("шкала скидок в переводах совпадает с POINTS_DISCOUNT_STEPS", () => {
    // Тексты в ru.json написаны без параметров — сверяем их со ступенями из кода.
    const tariffs = ru.landingComponents.tariffs;
    const scale = POINTS_DISCOUNT_STEPS.map((step) => `от ${step.from} — ${step.percent} %`).join(", ");
    for (const [name, value] of [
      ["pointsPicker.hint", tariffs.pointsPicker.hint],
      ["cells.pointsPaidScale", tariffs.cells.pointsPaidScale],
      ["subscriptionPage.rulePoints", ru.settingsUi.subscriptionPage.rulePoints],
    ] as const) {
      assert.ok(value.includes(scale), `${name}: ${value}`);
      assert.doesNotMatch(value, /\{(from|percent)/, `${name}: без параметров`);
    }
    assert.match(tariffs.cells.pointsPaidScale, /от 50 — индивидуально/);
    assert.match(ru.settingsUi.subscriptionPage.rulePoints, /от 50 — индивидуальное предложение/);
    assert.match(tariffs.individual.title, /^От 50 точек/);
  });

  it("значение тарифа → карточка витрины", () => {
    assert.equal(tierIdForPlan("free"), "free");
    assert.equal(tierIdForPlan("trial"), "free");
    assert.equal(tierIdForPlan(null), "free");
    assert.equal(tierIdForPlan("standard"), "standard");
    assert.equal(tierIdForPlan("premium"), "premium");
    assert.equal(tierIdForPlan("vip"), "vip");
    assert.equal(tierIdForPlan("paid"), "legacy");
  });

  it("таблица сравнения не расходится с лимитами: строки-возможности есть у Премиума и ВИП", () => {
    const rows = COMPARISON_GROUPS.flatMap((group) => group.rows);
    const featureRows = rows.filter((row) => row.feature);
    // Каждая возможность тарифа — строкой таблицы (в т. ч. «Меркурий»).
    assert.deepEqual(featureRows.map((row) => row.feature).sort(), [...PLAN_FEATURES].sort());
    for (const row of featureRows) {
      const feature = row.feature!;
      assert.equal(entitlementsFor("premium").features[feature], true, row.key);
      assert.equal(entitlementsFor("vip").features[feature], true, row.key);
      assert.equal(entitlementsFor("standard").features[feature], false, row.key);
      assert.equal(row.cells.premium.kind, "yes", row.key);
      assert.equal(row.cells.vip.kind, "yes", row.key);
      assert.equal(row.cells.standard.kind, "no", row.key);
    }
    // У каждой строки — клетка для каждого тарифа, включая «ВИП».
    for (const row of rows) for (const tier of TIER_IDS) assert.ok(row.cells[tier], `${row.key}.${tier}`);
    assert.deepEqual(TIER_IDS, ["free", "standard", "premium", "vip"]);
    assert.deepEqual(Object.keys(CARD_POINTS), ["free", "standard", "premium", "vip"]);
  });

  it("новые строки 2026-11-05: чек-листы везде, электронная ППК с «Премиума», сопровождение — только ВИП", () => {
    const rowOf = (key: string) => COMPARISON_GROUPS.flatMap((group) => group.rows).find((row) => row.key === key)!;
    assert.deepEqual(
      Object.values(rowOf("checklists").cells).map((cell) => cell.kind),
      ["yes", "yes", "yes", "yes"]
    );
    const ppk = rowOf("ppkElectronic").cells;
    assert.deepEqual([ppk.free.kind, ppk.standard.kind, ppk.premium.kind, ppk.vip.kind], ["text", "no", "yes", "yes"]);
    assert.equal(ppk.free.kind === "text" && ppk.free.key, "trialOnly");

    const service = COMPARISON_GROUPS.find((group) => group.key === "service")!;
    assert.deepEqual(service.rows.map((row) => row.key), ["hotline", "dataBank", "consultant"]);
    for (const row of service.rows) {
      for (const tier of ["free", "standard", "premium"] as const) assert.equal(row.cells[tier].kind, "no", `${row.key}.${tier}`);
      assert.notEqual(row.cells.vip.kind, "no", `${row.key}.vip`);
    }
    assert.deepEqual(rowOf("hotline").cells.vip, { kind: "text", key: "hotlineVip", values: { hours: VIP_HOTLINE_HOURS } });

    // Ячейка точек у платных — общая шкала без параметров.
    for (const tier of PAID_TIERS) assert.deepEqual(rowOf("points").cells[tier], { kind: "text", key: "pointsPaidScale", values: undefined });
    // «ВИП» — те же лимиты, что у «Премиума».
    for (const key of ["employees", "storage"]) assert.deepEqual(rowOf(key).cells.vip, rowOf(key).cells.premium, key);
    assert.deepEqual(
      CARD_POINTS.vip.map((point) => point.key),
      ["employeesPremium", "hotline", "dataBank", "consultant"]
    );
    assert.ok(CARD_POINTS.standard.some((point) => point.key === "checklists"));
    assert.ok(CARD_POINTS.premium.some((point) => point.key === "ppkElectronic"));
  });

  it("у каждой строки, группы, клетки и пункта карточки есть перевод во всех языках", async () => {
    const { loadMessages } = await import("@/i18n/messages");
    for (const locale of ["ru", "en", "uz"] as const) {
      const messages = (await loadMessages(locale)) as unknown as { landingComponents: { tariffs: Record<string, Record<string, unknown>> } };
      const tariffs = messages.landingComponents.tariffs;
      for (const group of COMPARISON_GROUPS) {
        assert.equal(typeof tariffs.groups[group.key], "string", `${locale}: groups.${group.key}`);
        for (const row of group.rows) {
          assert.equal(typeof tariffs.rows[row.key], "string", `${locale}: rows.${row.key}`);
          for (const cell of Object.values(row.cells)) {
            if (cell.kind === "text") assert.equal(typeof tariffs.cells[cell.key], "string", `${locale}: cells.${cell.key}`);
          }
        }
      }
      for (const tier of TIER_IDS) {
        assert.equal(typeof tariffs.includes[tier], "string", `${locale}: includes.${tier}`);
        assert.ok(tariffs.tiers[tier], `${locale}: tiers.${tier}`);
        for (const point of CARD_POINTS[tier]) assert.equal(typeof tariffs.features[point.key], "string", `${locale}: features.${point.key}`);
      }
      for (const key of ["title", "text", "cta"]) assert.equal(typeof tariffs.individual[key], "string", `${locale}: individual.${key}`);
    }
  });

  it("в текстах сайта и бота нет старой модели (1 сотрудник навсегда, до 10, сверх 10)", () => {
    const texts = JSON.stringify([NICHES, SEO_LANDINGS, COMPARISONS, BOT_PROFILE]);
    assert.doesNotMatch(texts, /Бесплатно для 1 сотрудника|до 10 сотрудников|сверх 10|бесплатно навсегда|навсегда бесплатно/i);
    assert.match(texts, /14 дней бесплатно/);
  });
});
