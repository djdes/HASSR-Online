import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FREE_PLAN_NOTE,
  FREE_PLAN_TITLE,
  FREE_SEATS_LABEL,
  FREE_TIER_SHORT,
  LARGE_TEAM_NOTE,
  PLAN_CATALOG,
  SUBSCRIPTION_MAX_USERS,
  SUBSCRIPTION_SEATS_LABEL,
  employeesGenitiveLabel,
  employeesLabel,
} from "@/lib/plan-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { COMPARISONS } from "@/content/comparisons";
import { WESETUP_BOT_PROFILE as BOT_PROFILE } from "@/lib/bot/setup";

describe("тариф 2026-10: 1 бесплатно, подписка до 10", () => {
  it("константы", () => {
    assert.equal(FREE_MAX_USERS, 1);
    assert.equal(SUBSCRIPTION_MAX_USERS, 10);
  });

  it("склонения: именительный и родительный", () => {
    assert.equal(employeesLabel(1), "1 сотрудник");
    assert.equal(employeesLabel(3), "3 сотрудника");
    assert.equal(employeesLabel(10), "10 сотрудников");
    assert.equal(employeesLabel(21), "21 сотрудник");
    assert.equal(employeesGenitiveLabel(1), "1 сотрудника");
    assert.equal(employeesGenitiveLabel(3), "3 сотрудников");
    assert.equal(employeesGenitiveLabel(10), "10 сотрудников");
  });

  it("фразы витрины собраны из констант", () => {
    assert.equal(FREE_SEATS_LABEL, "1 сотрудник");
    assert.equal(FREE_TIER_SHORT, "Бесплатно для 1 сотрудника");
    assert.equal(FREE_PLAN_TITLE, "Бесплатный тариф на 1 сотрудника");
    assert.equal(FREE_PLAN_NOTE, "Бесплатно для 1 сотрудника, без ограничений по записям.");
    assert.equal(SUBSCRIPTION_SEATS_LABEL, "до 10 сотрудников");
    assert.equal(LARGE_TEAM_NOTE, "Каждый сотрудник сверх 10 — 100 ₽/мес.");
    const free = PLAN_CATALOG.find((p) => p.id === "free");
    const paid = PLAN_CATALOG.find((p) => p.id === "paid");
    assert.equal(free?.features[0], "1 сотрудник");
    assert.equal(paid?.features[0], "До 10 сотрудников");
    assert.match(paid?.tagline ?? "", /до 10 сотрудников/);
  });

  it("в текстах сайта и бота не осталось старых лимитов (3 / 30)", () => {
    const texts = JSON.stringify([NICHES, SEO_LANDINGS, COMPARISONS, BOT_PROFILE]);
    assert.doesNotMatch(texts, /до 3 сотрудник|3 сотрудников|до 30\b|сверх 30/);
    assert.match(texts, /Бесплатно для 1 сотрудника/);
  });
});
