import { test } from "node:test";
import assert from "node:assert/strict";
import { ppkOverviewClassic, ppkReviewState, revisionItems } from "./overview-view";

test("новый вид обзора — по умолчанию; прежний — по cookie или у всех через окружение", () => {
  assert.equal(ppkOverviewClassic(undefined, undefined), false);
  assert.equal(ppkOverviewClassic("new", undefined), false);
  assert.equal(ppkOverviewClassic("classic", undefined), true);
  assert.equal(ppkOverviewClassic("junk", ""), false);
  assert.equal(ppkOverviewClassic(null, "1"), true);
  assert.equal(ppkOverviewClassic("new", "true"), true);
  assert.equal(ppkOverviewClassic("classic", "0"), true);
});

test("пересмотр программы: просрочен, скоро (30 дней) и в срок", () => {
  assert.equal(ppkReviewState("2026-11-23", "2026-11-24"), "overdue");
  assert.equal(ppkReviewState("2026-11-24", "2026-11-24"), "soon");
  assert.equal(ppkReviewState("2026-12-24", "2026-11-24"), "soon");
  assert.equal(ppkReviewState("2026-12-25", "2026-11-24"), "ok");
  assert.equal(ppkReviewState("2027-11-24", "2026-11-24"), "ok");
});

test("номера редакций — у политики 2.1 и текстов 1.8, 1.9, 2.2, 2.3, 2.9 и приложения № 3", () => {
  const items = revisionItems();
  assert.deepEqual(
    items.map((entry) => entry.id),
    ["1-8", "1-9", "2-1", "2-2", "2-3", "2-9", "app-3"],
  );
  assert.deepEqual(items.find((entry) => entry.id === "2-1")?.ref, { kind: "policy" });
  assert.deepEqual(items.find((entry) => entry.id === "app-3")?.ref, { kind: "text", block: "text-flow-schedule" });
});
