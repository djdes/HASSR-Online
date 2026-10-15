import assert from "node:assert/strict";
import test from "node:test";
import { shouldSyncCleaningSettings } from "@/lib/cleaning-settings-sync";

const saved = {
  title: "Cleaning schedule",
  cleaningRole: "Cleaner",
  cleaningUserId: "user-1",
  controlRole: "Manager",
  controlUserId: "user-2",
};

test("equivalent refreshed server settings preserve the open local draft", () => {
  const refreshed = { ...saved };
  assert.equal(shouldSyncCleaningSettings("doc-1", "doc-1", saved, refreshed), false);
});

test("real server settings and document changes still resynchronize the form", () => {
  assert.equal(
    shouldSyncCleaningSettings("doc-1", "doc-1", saved, { ...saved, title: "Updated" }),
    true,
  );
  assert.equal(shouldSyncCleaningSettings("doc-1", "doc-2", saved, saved), true);
});
