import { strict as assert } from "node:assert";
import test from "node:test";

import { resolveJournalAccessBootstrap } from "@/lib/staff-journal-bootstrap";

test("у должности без настроенных журналов строгий режим НЕ включается", () => {
  const result = resolveJournalAccessBootstrap([]);
  assert.equal(result.journalAccessMigrated, false);
  assert.deepEqual(result.grantedTemplateCodes, []);
});

test("у должности с журналами включается строгий режим и копируются коды", () => {
  const result = resolveJournalAccessBootstrap(["hygiene", "cleaning"]);
  assert.equal(result.journalAccessMigrated, true);
  assert.deepEqual(result.grantedTemplateCodes, ["hygiene", "cleaning"]);
});

test("дубли и пустые коды отбрасываются", () => {
  const result = resolveJournalAccessBootstrap([
    "hygiene",
    " hygiene ",
    "",
    "   ",
    "cleaning",
  ]);
  assert.equal(result.journalAccessMigrated, true);
  assert.deepEqual(result.grantedTemplateCodes, ["hygiene", "cleaning"]);
});
