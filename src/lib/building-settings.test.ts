import assert from "node:assert/strict";
import test from "node:test";

import {
  readBuildingJournalSettings,
  staffAtBuildingWhere,
  withBuildingJournalSettings,
  worksAtBuilding,
} from "./building-settings";
import { getJournalAutomation, listAutomationOwnedCodes } from "./journal-automation";

const ORG = {
  id: "org-1",
  autoJournalCodes: ["hygiene"],
  journalAutomationJson: { hygiene: { autoCreate: true, autoFill: true } },
  disabledJournalCodes: [],
};

test("withBuildingJournalSettings: заданное в точке заменяет организацию", () => {
  const point = withBuildingJournalSettings(ORG, {
    autoJournalCodes: ["climate_control"],
    journalAutomationJson: { climate_control: { autoCreate: true, autoFill: false } },
  });
  assert.deepEqual(point?.autoJournalCodes, ["climate_control"]);
  assert.equal(getJournalAutomation(point, "hygiene").autoCreate, false);
  assert.equal(getJournalAutomation(point, "climate_control").autoCreate, true);
  assert.deepEqual(listAutomationOwnedCodes(point), []);
  // Остальные поля организации не теряются.
  assert.equal(point?.id, "org-1");
});

test("withBuildingJournalSettings: null в точке — как у организации", () => {
  assert.equal(withBuildingJournalSettings(ORG, null), ORG);
  const point = withBuildingJournalSettings(ORG, { autoJournalCodes: null, journalAutomationJson: null });
  assert.deepEqual(point, ORG);
  const onlyCodes = withBuildingJournalSettings(ORG, { autoJournalCodes: [], journalAutomationJson: null });
  assert.deepEqual(onlyCodes?.autoJournalCodes, []);
  assert.deepEqual(onlyCodes?.journalAutomationJson, ORG.journalAutomationJson);
  assert.equal(withBuildingJournalSettings(null, { autoJournalCodes: [] }), null);
});

test("worksAtBuilding: пустой список точек — работает везде", () => {
  assert.equal(worksAtBuilding({ buildingIds: [] }, "b-1"), true);
  assert.equal(worksAtBuilding({ buildingIds: ["b-1"] }, "b-1"), true);
  assert.equal(worksAtBuilding({ buildingIds: ["b-2"] }, "b-1"), false);
  assert.equal(worksAtBuilding({ buildingIds: ["b-2"] }, null), true);
  assert.equal(worksAtBuilding({}, "b-1"), true);
});

test("staffAtBuildingWhere: без точки — без условия", () => {
  assert.deepEqual(staffAtBuildingWhere(null), {});
  assert.deepEqual(staffAtBuildingWhere("b-1"), {
    OR: [{ buildingIds: { isEmpty: true } }, { buildingIds: { has: "b-1" } }],
  });
});

test("readBuildingJournalSettings: точка без своих настроек — null", async () => {
  const rows: Record<string, { autoJournalCodes: unknown; journalAutomationJson: unknown }> = {
    own: { autoJournalCodes: ["hygiene"], journalAutomationJson: null },
    plain: { autoJournalCodes: null, journalAutomationJson: null },
  };
  const client = {
    building: {
      findUnique: async ({ where }: { where: { id: string } }) => rows[where.id] ?? null,
    },
  } as unknown as Parameters<typeof readBuildingJournalSettings>[0];
  assert.deepEqual(await readBuildingJournalSettings(client, "own"), rows.own);
  assert.equal(await readBuildingJournalSettings(client, "plain"), null);
  assert.equal(await readBuildingJournalSettings(client, "missing"), null);
  assert.equal(await readBuildingJournalSettings(client, null), null);
});
