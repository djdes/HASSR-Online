import test from "node:test";
import assert from "node:assert/strict";

import { verifierNotice } from "./checklist-assignments";

const inspection = {
  id: "insp-1",
  organizationId: "org-1",
  title: "Чек-лист СанПиН",
  status: "completed",
  result: { score: { earned: 9, possible: 10 }, violations: [{}], critical: [], stopped: false },
  completedById: "cook",
  completedByName: "Волкова Анна",
};

test("уведомление проверяющему: кому и когда", () => {
  const notice = verifierNotice({ inspection, verifierUserId: "chef", verifier: { id: "chef", telegramChatId: " 555 " } });
  assert.ok(!("skip" in notice));
  assert.equal(notice.chatId, "555");
  assert.equal(notice.userId, "chef");
  assert.equal(notice.path, "/checklists/results?inspection=insp-1");
  assert.match(notice.text, /Чек-лист СанПиН/);
  assert.match(notice.text, /9 из 10 \(90%\)/);
  assert.match(notice.text, /Волкова Анна/);
  assert.deepEqual(verifierNotice({ inspection: { ...inspection, status: "draft" }, verifierUserId: "chef", verifier: { id: "chef", telegramChatId: "555" } }), { skip: "not-completed" });
  assert.deepEqual(verifierNotice({ inspection, verifierUserId: null, verifier: null }), { skip: "no-verifier" });
  assert.deepEqual(verifierNotice({ inspection, verifierUserId: "cook", verifier: { id: "cook", telegramChatId: "1" } }), { skip: "self" });
  assert.deepEqual(verifierNotice({ inspection, verifierUserId: "chef", verifier: { id: "chef", telegramChatId: null } }), { skip: "no-telegram" });
  // Уволенного проверяющего загрузка не находит — не пишем.
  assert.deepEqual(verifierNotice({ inspection, verifierUserId: "chef", verifier: null }), { skip: "no-telegram" });
});

test("уведомление проверяющему: отправка подменена — настоящий Telegram не вызывается", async () => {
  const { notifyChecklistVerifier } = await import("./checklist-assignments.server");
  const calls: { chatId: string; text: string; opts: { userId: string; reply_markup?: unknown; delivery?: { kind: string; dedupeKey: string } } }[] = [];
  const outcome = await notifyChecklistVerifier("insp-1", {
    load: async () => ({ inspection, verifierUserId: "chef", verifier: { id: "chef", telegramChatId: "555" } }),
    send: async (chatId, text, opts) => {
      calls.push({ chatId, text, opts });
      return true;
    },
    miniAppUrl: (path) => `https://wesetup.test${path}`,
  });
  assert.equal(outcome.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, "555");
  assert.equal(calls[0].opts.userId, "chef");
  assert.equal(calls[0].opts.delivery?.kind, "checklist_review");
  assert.equal(calls[0].opts.delivery?.dedupeKey, "checklist-review:insp-1");
  assert.deepEqual(calls[0].opts.reply_markup, {
    inline_keyboard: [[{ text: "Открыть результат", web_app: { url: "https://wesetup.test/checklists/results?inspection=insp-1" } }]],
  });
  const skipped = await notifyChecklistVerifier("insp-1", {
    load: async () => ({ inspection, verifierUserId: "chef", verifier: { id: "chef", telegramChatId: null } }),
    send: async () => {
      throw new Error("не должно вызываться");
    },
  });
  assert.deepEqual(skipped, { sent: false, reason: "no-telegram" });
});
