import assert from "node:assert/strict";
import test from "node:test";

import { avitoChatIdFromKey, avitoExternalKey, avitoMessageBody, mapAvitoMessage, type AvitoChat } from "@/lib/avito/messenger";

const chat: AvitoChat = {
  id: "u2i-abc~def",
  users: [{ id: 407043143, name: "СЕТАП" }, { id: 555, name: "Ирина" }],
  context: { type: "item", value: { id: 1, title: "Электронные журналы ХАССП" } },
};

test("входящее и наше сообщение → записи CRM с собеседником и объявлением", () => {
  const inbound = mapAvitoMessage(chat, { id: "m1", author_id: 555, created: 1_763_880_000, direction: "in", type: "text", content: { text: "Сколько стоит?" } }, "407043143", "СЕТАП");
  assert.equal(inbound?.direction, "in");
  assert.equal(inbound?.channel, "avito");
  assert.equal(inbound?.subject, "Авито: Электронные журналы ХАССП");
  assert.deepEqual(inbound?.identity, { avitoUserId: "555", name: "Ирина" });
  assert.equal(inbound?.externalKey, "avito:u2i-abc~def:m1");
  assert.equal(inbound?.occurredAt.toISOString(), new Date(1_763_880_000_000).toISOString());

  const outbound = mapAvitoMessage(chat, { id: "m2", author_id: 407043143, created: 1_763_880_100, type: "text", content: { text: "2 990 ₽ в месяц" } }, "407043143", "СЕТАП");
  assert.equal(outbound?.direction, "out");
  assert.equal(outbound?.authorName, "СЕТАП");
});

test("служебные сообщения пропускаем, вложения подписываем", () => {
  assert.equal(avitoMessageBody({ id: "s", created: 1, type: "system", content: { text: "Сделка" } }), null);
  assert.equal(avitoMessageBody({ id: "i", created: 1, type: "image" }), "[Фото]");
  assert.match(avitoMessageBody({ id: "v", created: 1, type: "voice" }) ?? "", /Голосовое/);
});

test("id чата из ключа записи", () => {
  assert.equal(avitoChatIdFromKey(avitoExternalKey("u2i-abc~def", "m9")), "u2i-abc~def");
  assert.equal(avitoChatIdFromKey("email:x"), null);
});
