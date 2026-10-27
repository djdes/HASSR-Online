import assert from "node:assert/strict";
import test from "node:test";

import { journalPointsOf, wholeOrgPoints } from "@/lib/master-pool-points";

const buildings = [
  { id: "school5", name: "Школа № 5", kind: "point", linkedServiceCode: null },
  { id: "office", name: "Офис", kind: "office", linkedServiceCode: null },
  { id: "school7", name: "Школа № 7", kind: "point", linkedServiceCode: "GARDN-00000" },
  { id: "school9", name: "Школа № 9", kind: "point", linkedServiceCode: "SCHOL-00000" },
];

test("точки со своими журналами: только торговые точки и только при журналах по точкам", () => {
  assert.deepEqual(journalPointsOf({ perLocationJournals: true }, buildings).map((b) => b.id), ["school5", "school7", "school9"]);
  assert.deepEqual(journalPointsOf({ perLocationJournals: false }, buildings), []);
});

test("организация целиком в кабинете — её точки, кроме подключённых к другому кабинету", () => {
  assert.deepEqual(
    wholeOrgPoints({ perLocationJournals: true }, buildings, "SCHOL-00000").map((b) => b.id),
    ["school5", "school9"]
  );
  assert.deepEqual(wholeOrgPoints({ perLocationJournals: false }, buildings, "SCHOL-00000"), []);
});
