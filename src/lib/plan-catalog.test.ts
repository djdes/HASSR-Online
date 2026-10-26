import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CARD_POINTS,
  COMPARISON_GROUPS,
  FREE_PLAN_NOTE,
  FREE_PLAN_TITLE,
  FREE_TIER_SHORT,
  PAID_SEATS_LABEL,
  POINTS_NOTE,
  employeesGenitiveLabel,
  employeesLabel,
  pricesFromLine,
  tierIdForPlan,
} from "@/lib/plan-catalog";
import { DEFAULT_PLAN_RATES, PLAN_FEATURES, TIER_IDS, entitlementsFor } from "@/lib/tariff-plans";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { COMPARISONS } from "@/content/comparisons";
import { WESETUP_BOT_PROFILE as BOT_PROFILE } from "@/lib/bot/setup";

describe("тарифы 2026-10: Бесплатный 14 дней, Стандарт, Премиум", () => {
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
    assert.match(POINTS_NOTE, /от 3 точек — скидка 5 % на каждую/);
    assert.match(pricesFromLine(DEFAULT_PLAN_RATES), /«Стандарт» — от 1\s990 ₽\/мес, «Премиум» — от 3\s990 ₽\/мес/);
  });

  it("значение тарифа → карточка витрины", () => {
    assert.equal(tierIdForPlan("free"), "free");
    assert.equal(tierIdForPlan("trial"), "free");
    assert.equal(tierIdForPlan(null), "free");
    assert.equal(tierIdForPlan("standard"), "standard");
    assert.equal(tierIdForPlan("premium"), "premium");
    assert.equal(tierIdForPlan("paid"), "legacy");
  });

  it("таблица сравнения не расходится с лимитами: строки-возможности есть только у Премиума", () => {
    const rows = COMPARISON_GROUPS.flatMap((group) => group.rows);
    const featureRows = rows.filter((row) => row.feature);
    // Каждая возможность тарифа — строкой таблицы (в т. ч. «Меркурий»).
    assert.deepEqual(featureRows.map((row) => row.feature).sort(), [...PLAN_FEATURES].sort());
    for (const row of featureRows) {
      const feature = row.feature!;
      assert.equal(entitlementsFor("premium").features[feature], true, row.key);
      assert.equal(entitlementsFor("standard").features[feature], false, row.key);
      assert.equal(row.cells.premium.kind, "yes", row.key);
      assert.equal(row.cells.standard.kind, "no", row.key);
    }
    // У каждой строки — клетка для каждого тарифа.
    for (const row of rows) for (const tier of TIER_IDS) assert.ok(row.cells[tier], `${row.key}.${tier}`);
    assert.deepEqual(Object.keys(CARD_POINTS), ["free", "standard", "premium"]);
  });

  it("в текстах сайта и бота нет старой модели (1 сотрудник навсегда, до 10, сверх 10)", () => {
    const texts = JSON.stringify([NICHES, SEO_LANDINGS, COMPARISONS, BOT_PROFILE]);
    assert.doesNotMatch(texts, /Бесплатно для 1 сотрудника|до 10 сотрудников|сверх 10|бесплатно навсегда|навсегда бесплатно/i);
    assert.match(texts, /14 дней бесплатно/);
  });
});
