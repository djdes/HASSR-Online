import assert from "node:assert/strict";
import test from "node:test";
import { recoverAdminTelegramMessages, type RecoverableAdminMessage } from "./admin-telegram-recovery";

const since = new Date("2026-09-30T00:00:00Z");
const row = (id: string, changes: Partial<RecoverableAdminMessage> = {}): RecoverableAdminMessage => ({
  id, chatId: "admin", body: "Онлайн-чат #chat_thread1", status: "failed",
  createdAt: new Date("2026-10-04T12:00:00Z"), ...changes,
});

function stand() {
  const sent: string[] = [];
  const rows = new Map<string, string>();
  let pauses = 0;
  const deps = {
    async claim(message: RecoverableAdminMessage) {
      if (rows.has(message.id)) return false;
      rows.set(message.id, "queued"); return true;
    },
    async send(_message: RecoverableAdminMessage, text: string) { sent.push(text); },
    async markSent(message: RecoverableAdminMessage) { rows.set(message.id, "sent"); },
    async markFailed(message: RecoverableAdminMessage, uncertain: boolean) { rows.set(message.id, uncertain ? "recovery_uncertain" : "failed"); },
    async pause() { pauses++; },
  };
  return { deps, sent, rows, pauses: () => pauses };
}

test("recovery excludes customers, successful deliveries and pre-outage history", async () => {
  const s = stand();
  const result = await recoverAdminTelegramMessages([
    row("customer", { chatId: "customer" }), row("sent", { status: "sent" }),
    row("old", { createdAt: new Date("2026-09-29") }), row("valid"),
  ], { chatIds: ["admin"], since }, s.deps);
  assert.deepEqual(result, { sent: 1, skipped: 3, failed: 0, uncertain: 0 });
  assert.match(s.sent[0], /#chat_thread1/);
  assert.match(s.sent[0], /04\.10\.2026/);
});

test("atomic claim prevents duplicates when the recovery is rerun", async () => {
  const s = stand(); const messages = [row("a"), row("b")];
  await recoverAdminTelegramMessages(messages, { chatIds: ["admin"], since }, s.deps);
  const again = await recoverAdminTelegramMessages(messages, { chatIds: ["admin"], since }, s.deps);
  assert.equal(s.sent.length, 2); assert.equal(s.pauses(), 1);
  assert.equal(again.sent, 0); assert.equal(again.skipped, 2);
});

test("a failed send stays failed and is not counted as delivered", async () => {
  const s = stand(); s.deps.send = async () => { throw new Error("network failure"); };
  const result = await recoverAdminTelegramMessages([row("a")], { chatIds: ["admin"], since }, s.deps);
  assert.equal(result.failed, 1); assert.equal(result.sent, 0); assert.equal(s.rows.get("a"), "failed");
});

test("confirmed delivery with a failed status update cannot be replayed automatically", async () => {
  const s = stand(); s.deps.markSent = async () => { throw new Error("database failure"); };
  const result = await recoverAdminTelegramMessages([row("a")], { chatIds: ["admin"], since }, s.deps);
  assert.equal(result.uncertain, 1); assert.equal(result.sent, 0);
  assert.equal(s.rows.get("a"), "recovery_uncertain");
});

test("long original messages remain intact within Telegram's limit", async () => {
  const s = stand(); const body = "x".repeat(4096);
  await recoverAdminTelegramMessages([row("a", { body })], { chatIds: ["admin"], since }, s.deps);
  assert.equal(s.sent[0], body);
});

test("attachment audit text is not replayed as a fake attachment", async () => {
  const s = stand();
  const result = await recoverAdminTelegramMessages([row("a", { body: "[attachment] file.txt" })], { chatIds: ["admin"], since }, s.deps);
  assert.equal(result.skipped, 1); assert.equal(s.sent.length, 0);
});
