import assert from "node:assert/strict";
import test from "node:test";
import {
  countConfigRecords,
  deletedRecordsBullet,
  restoreMenuItems,
  type RestorableDocument,
} from "@/components/journals/document-list-ui";

test("deleted-record copy retains null, empty, and counted-row behavior", () => {
  const copy = {
    empty: "No records",
    count: (count: number) => `Delete ${count}`,
  };
  assert.equal(countConfigRecords(null), null);
  assert.equal(deletedRecordsBullet(null, copy), null);
  assert.deepEqual(deletedRecordsBullet({ rows: [] }, copy), {
    label: "No records",
    tone: "warn",
  });
  assert.deepEqual(deletedRecordsBullet({ rows: [{}, {}] }, copy), {
    label: "Delete 2",
    tone: "warn",
  });
});

test("restore menu stays closed-only and uses the supplied localized label", async () => {
  const document = { id: "doc-1", status: "closed" };
  const siblings = [{ id: "doc-2", status: "active" }];
  let called = false;
  const restore = async (actualDocument: RestorableDocument, actualSiblings: RestorableDocument[] = []) => {
    called = actualDocument === document && actualSiblings === siblings;
    return true;
  };
  assert.deepEqual(restoreMenuItems({
    document: { id: "active", status: "active" },
    restore,
    label: "Restore",
  }), []);
  const [item] = restoreMenuItems({ document, siblings, restore, label: "Restore" });
  assert.equal(item.label, "Restore");
  item.onSelect();
  await Promise.resolve();
  assert.equal(called, true);
});
