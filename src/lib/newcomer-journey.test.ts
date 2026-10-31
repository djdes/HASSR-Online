import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  composeJourneyEmail,
  isJourneyStep,
  journeyAgeDays,
  nextJourneyStep,
  type JourneyFacts,
  type JourneyStep,
} from "@/lib/newcomer-journey";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-10T03:15:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function facts(over: Partial<JourneyFacts> = {}): JourneyFacts {
  return {
    createdAt: daysAgo(3),
    now,
    hasEntries: false,
    activeUsers: 1,
    demoExpiresAt: null,
    sentSteps: new Set<JourneyStep>(),
    lastSentAt: null,
    wroteSupportRecently: false,
    ...over,
  };
}

describe("письма первых шагов: какой шаг и когда", () => {
  it("окно — со 2-го по 14-й день, раньше и позже ничего", () => {
    assert.equal(journeyAgeDays(daysAgo(2.5), now), 2);
    assert.equal(nextJourneyStep(facts({ createdAt: daysAgo(1.9) })), null);
    assert.equal(nextJourneyStep(facts({ createdAt: daysAgo(2) })), "first_qr");
    assert.equal(nextJourneyStep(facts({ createdAt: daysAgo(15) })), null);
  });

  it("первый шаг — один из двух: нет записей → холодильник; записи есть, человек один → позвать смену; команда есть → не нужен", () => {
    assert.equal(nextJourneyStep(facts()), "first_qr");
    assert.equal(nextJourneyStep(facts({ hasEntries: true })), "invite_team");
    assert.equal(nextJourneyStep(facts({ hasEntries: true, activeUsers: 3 })), null);
    assert.equal(nextJourneyStep(facts({ sentSteps: new Set<JourneyStep>(["first_qr"]) })), null);
    assert.equal(nextJourneyStep(facts({ hasEntries: true, sentSteps: new Set<JourneyStep>(["first_qr"]) })), null);
  });

  it("демо удаляется в ближайшие двое суток — напоминание, позже и после удаления — нет", () => {
    const sent = new Set<JourneyStep>(["first_qr"]);
    assert.equal(nextJourneyStep(facts({ sentSteps: sent, demoExpiresAt: new Date(now.getTime() + DAY) })), "demo_expiring");
    assert.equal(nextJourneyStep(facts({ sentSteps: sent, demoExpiresAt: new Date(now.getTime() + 3 * DAY) })), null);
    assert.equal(nextJourneyStep(facts({ sentSteps: sent, demoExpiresAt: new Date(now.getTime() - DAY) })), null);
  });

  it("«что увидит проверяющий» — с 9-го дня, один раз", () => {
    const sent = new Set<JourneyStep>(["first_qr"]);
    assert.equal(nextJourneyStep(facts({ createdAt: daysAgo(8), sentSteps: sent })), null);
    assert.equal(nextJourneyStep(facts({ createdAt: daysAgo(9), sentSteps: sent })), "inspector_view");
    assert.equal(nextJourneyStep(facts({ createdAt: daysAgo(9), sentSteps: new Set<JourneyStep>(["first_qr", "inspector_view"]) })), null);
  });

  it("не чаще раза в сутки и не тому, кто только что писал в поддержку", () => {
    assert.equal(nextJourneyStep(facts({ lastSentAt: new Date(now.getTime() - 5 * 60 * 60 * 1000) })), null);
    assert.equal(nextJourneyStep(facts({ lastSentAt: new Date(now.getTime() - DAY) })), "first_qr");
    assert.equal(nextJourneyStep(facts({ wroteSupportRecently: true })), null);
    assert.equal(isJourneyStep("first_qr"), true);
    assert.equal(isJourneyStep("other"), false);
  });
});

describe("письма первых шагов: тексты", () => {
  const appUrl = "https://wesetup.ru";
  it("у каждого шага — своя тема, кнопка на нужный раздел и подпись серии", () => {
    const cases: Array<[JourneyStep, RegExp, string]> = [
      ["first_qr", /^Начните с одного холодильника$/, "/settings/qr-posters"],
      ["invite_team", /^Теперь позовите смену$/, "/staff"],
      ["demo_expiring", /^Демо удалится 12 ноября$/, "/dashboard"],
      ["inspector_view", /^Что увидит проверяющий$/, "/inspection"],
    ];
    for (const [step, subject, path] of cases) {
      const mail = composeJourneyEmail(step, { orgName: "Кафе &amp; Ко", appUrl, demoUntil: "12 ноября" });
      assert.match(mail.subject, subject, step);
      assert.match(mail.html, new RegExp(`href="${appUrl}${path}"`), step);
      assert.match(mail.html, /их не больше трёх/, step);
      assert.match(mail.html, /ответьте на это письмо/, step);
    }
    assert.match(composeJourneyEmail("first_qr", { orgName: "Кафе &amp; Ко", appUrl }).html, /«Кафе &amp; Ко»/);
    assert.equal(composeJourneyEmail("demo_expiring", { orgName: "Цех", appUrl }).subject, "Демо скоро удалится");
  });

  it("сервер: окно, исключения, стоп-лист, запись шага после отправки; запуск из ежедневной задачи", () => {
    const server = read("src/lib/newcomer-journey.server.ts");
    assert.match(server, /isDemo: false,\s*id: \{ not: platformOrgId\(\) \},\s*locale: "ru",/);
    assert.match(server, /if \(isInactivePlan\(org\.subscriptionPlan\)\) continue;/);
    assert.match(server, /db\.emailSuppression\.findUnique\(\{ where: \{ email \}/);
    assert.match(server, /if \(!delivered\) \{\s*report\.failed \+= 1;\s*continue;\s*\}\s*await db\.auditLog\.create/);
    assert.match(server, /replyTo: SUPPORT_EMAIL/);
    const cron = read("src/app/api/cron/billing-transition/route.ts");
    assert.match(cron, /const journey = await runNewcomerJourney\(\{ dryRun \}\)\.catch/);
    assert.match(cron, /NextResponse\.json\(\{ \.\.\.report, journey \}\)/);
  });
});
