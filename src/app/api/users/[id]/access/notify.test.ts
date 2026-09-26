import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * «Вам назначены журналы» — личное сообщение сотруднику. Оно обязано идти
 * через notifyEmployee: там тихие часы, snooze и push в приложение
 * (ночью push откладывается до утра вместе с Telegram). Прямой push из
 * маршрута будил бы человека ночью.
 */
test("назначение журналов: через notifyEmployee, без прямого push", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/api/users/[id]/access/route.ts"),
    "utf8",
  );
  assert.match(source, /notifyEmployee\(/);
  assert.doesNotMatch(source, /sendMobilePushInBackground\(/);
  assert.doesNotMatch(source, /sendTelegramMessage\(/);
});
