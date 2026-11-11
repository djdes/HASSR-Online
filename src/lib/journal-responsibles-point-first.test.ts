import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

// Wiring inside the cascade (database code) is checked through its source.
const source = fs.readFileSync(path.join(process.cwd(), "src/lib/journal-responsibles-cascade.ts"), "utf8");

test("ростер точки: свои люди раньше тех, кто работает везде", async () => {
  const { pointStaffFirst } = await import("@/lib/journal-responsibles-cascade");
  const users = [
    { id: "a-everywhere", buildingIds: [] },
    { id: "b-own", buildingIds: ["p1"] },
    { id: "c-everywhere", buildingIds: null },
    { id: "d-own", buildingIds: ["p2", "p1"] },
  ];
  assert.deepEqual(pointStaffFirst(users, "p1").map((user) => user.id), ["b-own", "d-own", "a-everywhere", "c-everywhere"]);
  assert.match(source, /point \? pointStaffFirst\(atPoint, point\.id\) : atPoint/);
});

test("автоподбор пустых слотов идёт через pickRosterForUnsetSlot, а не «первого по алфавиту»", () => {
  assert.equal(source.includes("rankRosterForSlot("), false);
  assert.equal(source.match(/pickRosterForUnsetSlot\(/g)?.length, 2);
  assert.match(source, /slot\.id === getPrimarySlotId\(journalCode\) \|\| rankKindForSlot\(slot\) === "verifier"/);
});
