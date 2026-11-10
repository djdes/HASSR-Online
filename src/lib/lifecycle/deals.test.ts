import assert from "node:assert/strict";
import test from "node:test";

import { autoAdvance, dealKey, stageForOutcome } from "./deals";

test("автоматика двигает только вперёд; ручную колонку — только в «Оплачено» и «Отказ»", () => {
  assert.equal(autoAdvance({ stage: "registered", stageManual: false }, "contract_signed"), "contract_signed");
  assert.equal(autoAdvance({ stage: "registered", stageManual: false }, "message_sent"), "message_sent");
  assert.equal(autoAdvance({ stage: "message_sent", stageManual: false }, "contract_signed"), null);
  assert.equal(autoAdvance({ stage: "called", stageManual: false }, "message_sent"), null);
  assert.equal(autoAdvance({ stage: "registered", stageManual: true }, "message_sent"), null);
  assert.equal(autoAdvance({ stage: "registered", stageManual: true }, "won"), "won");
  assert.equal(autoAdvance({ stage: "called", stageManual: true }, "lost"), "lost");
  assert.equal(autoAdvance({ stage: "won", stageManual: false }, "lost"), null);
  assert.equal(autoAdvance({ stage: "lost", stageManual: false }, "called"), null);
  assert.equal(autoAdvance({ stage: "lost", stageManual: false }, "won"), "won");
});

test("итог звонка → колонка; ключ сделки — один на период", () => {
  assert.equal(stageForOutcome("reached"), "called");
  assert.equal(stageForOutcome("promised"), "called");
  assert.equal(stageForOutcome("declined"), "lost");
  assert.equal(stageForOutcome("no_answer"), null);
  assert.equal(dealKey("trial", "acc1", new Date("2026-11-18T00:00:00+03:00")), "trial:acc1:2026-11-17");
});
