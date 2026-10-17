import assert from "node:assert/strict";
import test from "node:test";
import { ackKnowledgeId, ackKnowledgeKey, isAckDocKey, ackDocPath, formatAckMoment } from "./acknowledge";

test("isAckDocKey принимает только известные ключи", () => {
  assert.equal(isAckDocKey("policy"), true);
  assert.equal(isAckDocKey("team-regulation"), true);
  assert.equal(isAckDocKey("knowledge:cm1abc"), true);
  assert.equal(isAckDocKey("knowledge:"), false);
  assert.equal(isAckDocKey("knowledge:a b"), false);
  assert.equal(isAckDocKey("knowledge:../x"), false);
  assert.equal(isAckDocKey("norms"), false);
  assert.equal(isAckDocKey(""), false);
  assert.equal(isAckDocKey(42), false);
});

test("разбор и сборка ключа инструкции", () => {
  assert.equal(ackKnowledgeKey("abc123"), "knowledge:abc123");
  assert.equal(ackKnowledgeId("knowledge:abc123"), "abc123");
  assert.equal(ackKnowledgeId("policy"), null);
});

test("адрес страницы ознакомления", () => {
  assert.equal(ackDocPath("policy"), "/acknowledge/policy");
  assert.equal(ackDocPath("knowledge:abc"), "/acknowledge/knowledge%3Aabc");
});

test("дата и время отметки — в поясе организации", () => {
  assert.deepEqual(formatAckMoment("2026-10-17T21:30:00.000Z", "Europe/Moscow"), { date: "18.10.2026", time: "00:30" });
  assert.deepEqual(formatAckMoment("2026-10-17T21:30:00.000Z", "Not/AZone"), { date: "18.10.2026", time: "00:30" });
});
