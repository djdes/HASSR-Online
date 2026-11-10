import assert from "node:assert/strict";
import { test } from "node:test";

import { tasksSnapshotFrom } from "./refresh";

test("today's tasks are trimmed to what the offline screen shows", () => {
  const snapshot = tasksSnapshotFrom(
    "u1",
    {
      dateKey: "2026-11-10",
      groups: [
        {
          code: "cleaning",
          label: "Уборка",
          scopes: [
            { scopeKey: "room-1", scopeLabel: "Зал", sublabel: "утро", availability: "taken", claimUserName: "Анна" },
            { scopeKey: "room-2", scopeLabel: "Кухня", availability: "weird" },
            { scopeLabel: "без ключа" },
          ],
        },
        { code: "empty", label: "Пусто", scopes: [] },
        { label: "без кода", scopes: [{ scopeKey: "x", scopeLabel: "x" }] },
      ],
    },
    123,
  );
  assert.deepEqual(snapshot, {
    userId: "u1",
    savedAt: 123,
    dateKey: "2026-11-10",
    groups: [
      {
        code: "cleaning",
        label: "Уборка",
        tasks: [
          { key: "room-1", label: "Зал", sublabel: "утро", state: "taken", by: "Анна" },
          { key: "room-2", label: "Кухня", sublabel: null, state: "available", by: null },
        ],
      },
    ],
  });
});

test("an empty answer gives an empty list, not an error", () => {
  assert.deepEqual(tasksSnapshotFrom("u1", {}, 1).groups, []);
});
