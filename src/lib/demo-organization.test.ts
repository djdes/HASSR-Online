import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEMO_HISTORY_DAYS,
  SHARED_DEMO_ORG_ID,
  demoNextResetAt,
  demoOrgName,
  isDemoOverdue,
} from "@/lib/demo-organization.shared";
import { getDemoRoster } from "@/lib/demo-organization-roster";
import { getOnboardingPreset } from "@/lib/onboarding-presets";

describe("getDemoRoster", () => {
  for (const type of ["restaurant", "bakery", "meat", "other"]) {
    it(`${type}: каждая должность есть в пресете и даёт доступ к гигиене`, () => {
      const preset = getOnboardingPreset(type);
      const roster = getDemoRoster(type);
      for (const person of roster.people) {
        const position = preset.positions.find((p) => p.name === person.position);
        assert.ok(position, `${person.name}: должность «${person.position}» не в пресете ${type}`);
        assert.ok(
          position.journalCodes.includes("hygiene"),
          `${person.position}: нет доступа к гигиеническому журналу`
        );
      }
    });

    it(`${type}: телефоны и ФИО уникальны, есть управляющий и уборщик`, () => {
      const roster = getDemoRoster(type);
      const phones = new Set(roster.people.map((p) => p.phone));
      const names = new Set(roster.people.map((p) => p.name));
      assert.equal(phones.size, roster.people.length);
      assert.equal(names.size, roster.people.length);
      assert.ok(roster.people.some((p) => p.role === "manager"));
      assert.ok(roster.people.some((p) => p.position === "Уборщик"));
      assert.ok(roster.rooms.length >= 3);
      assert.ok(roster.areas.some((a) => a.equipment.some((e) => e.tempMax < 0)));
    });
  }
});

describe("demoOrgName", () => {
  it("берёт label сферы из анкеты", () => {
    assert.equal(demoOrgName("cafe"), "Демо — Кафе / Кофейня");
    assert.equal(demoOrgName("bakery"), "Демо — Пекарня");
  });

  it("незнакомая сфера → «Другое», а не пустое имя", () => {
    assert.equal(demoOrgName("???"), "Демо — Другое");
    assert.equal(demoOrgName(undefined), "Демо — Другое");
  });
});

describe("общая демо: переустановка раз в сутки", () => {
  const now = new Date("2026-09-02T10:00:00Z");

  it("id постоянный, история — DEMO_HISTORY_DAYS дней", () => {
    assert.equal(SHARED_DEMO_ORG_ID, "demo");
    assert.equal(DEMO_HISTORY_DAYS, 7);
  });

  it("следующая переустановка — через сутки после установки", () => {
    assert.equal(demoNextResetAt(now).toISOString(), "2026-09-03T10:00:00.000Z");
  });

  it("просрочена, когда срок вышел или не записан", () => {
    const due = demoNextResetAt(now);
    assert.equal(isDemoOverdue(due, now), false);
    assert.equal(isDemoOverdue(due, new Date("2026-09-03T09:59:59Z")), false);
    assert.equal(isDemoOverdue(due, due), true);
    assert.equal(isDemoOverdue(due, new Date("2026-09-05T00:00:00Z")), true);
    assert.equal(isDemoOverdue(null, now), true);
  });
});
