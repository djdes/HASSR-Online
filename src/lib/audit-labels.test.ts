import test from "node:test";
import assert from "node:assert/strict";

import { auditActionLabel, auditDetailPairs } from "./audit-labels";

const asText = (details: Record<string, unknown>) =>
  auditDetailPairs(details).map((pair) => `${pair.label}: ${pair.value}`);

test("служебные id не показываются, перечисления переводятся", () => {
  assert.deepEqual(
    asText({
      via: "qr_join_token",
      joinTokenId: "cmu45abcdefghijklmnopqrst",
      journalsGranted: 0,
      partnerId: "cmu45abcdefghijklmnopqrst",
      applyTo: "all",
    }),
    ["Способ: QR-приглашение", "Выдано журналов: 0", "Применено: ко всем бланкам"]
  );
});

test("значение, похожее на cuid, скрывается даже под обычным ключом", () => {
  assert.deepEqual(asText({ journalCode: "cmu45abcdefghijklmnopqrst" }), []);
});

test("код журнала — названием, поля — подписями, «было → стало» строкой", () => {
  const [journal] = asText({ journalCode: "hygiene" });
  assert.match(journal, /^Журнал: /);
  assert.doesNotMatch(journal, /hygiene/);

  assert.deepEqual(asText({ changed: { journalShortName: { from: "Старое", to: "Новое" } } }), [
    "Изменено: Название для журналов: Старое → Новое",
  ]);
  assert.deepEqual(asText({ taskFlowMode: { from: "race", to: "manual" } }), [
    "Режим задач: Гонка → Только руководитель назначает",
  ]);
});

test("новые действия по задачам и настройкам подписаны по-русски", () => {
  for (const code of [
    "task.claim",
    "task.complete",
    "task.release",
    "task.skip",
    "task.assign",
    "task.verify.approve",
    "task.verify.reject",
    "settings.journal_scope.update",
    "settings.task_flow_mode.update",
    "organization.settings.update",
    "equipment.update",
    "dashboard.close_day",
    "journal.enable",
  ]) {
    assert.notEqual(auditActionLabel(code).label, code, code);
  }
});
