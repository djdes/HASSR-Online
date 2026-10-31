import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { NEWCOMER_QUIET_HOURS, isWithinNewcomerQuietWindow, skipComplianceReminder } from "@/lib/newcomer-scope";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-02T18:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

describe("«незаполненные журналы» — не новичкам и не демо", () => {
  it("демо пропускаем всегда, даже с записями", () => {
    assert.equal(skipComplianceReminder({ isDemo: true, createdAt: ago(500) }, true, now), true);
  });

  it("новичок без единой записи первые 48 часов — без напоминаний; с записями — как все", () => {
    assert.equal(NEWCOMER_QUIET_HOURS, 48);
    assert.equal(skipComplianceReminder({ isDemo: false, createdAt: ago(5) }, false, now), true);
    assert.equal(skipComplianceReminder({ isDemo: false, createdAt: ago(47) }, false, now), true);
    assert.equal(skipComplianceReminder({ isDemo: false, createdAt: ago(5) }, true, now), false);
    assert.equal(skipComplianceReminder({ isDemo: false, createdAt: ago(49) }, false, now), false);
    assert.equal(isWithinNewcomerQuietWindow(ago(47), now), true);
    assert.equal(isWithinNewcomerQuietWindow(ago(48), now), false);
  });

  it("крон спрашивает про записи только у молодых организаций и пропускает по правилу", () => {
    const route = readFileSync(new URL("../app/api/cron/compliance/route.ts", import.meta.url), "utf8");
    assert.match(route, /select: \{[^}]*isDemo: true, createdAt: true \}/);
    assert.match(route, /isWithinNewcomerQuietWindow\(org\.createdAt, now\)\s*\? await organizationHasEntries\(org\.id\)\s*: true;/);
    assert.match(route, /if \(skipComplianceReminder\(org, hasEntries, now\)\) continue;/);
  });
});
