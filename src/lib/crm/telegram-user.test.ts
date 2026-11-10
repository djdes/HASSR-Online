import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCrmPeer, mapTgMessage, mediaLabel, parseCursorState, parseIgnoreList, parseSocksProxy, peerName, tgMessageBody, tgPhone, type TgPeer } from "@/lib/crm/telegram-user";
import { computeContactState } from "@/lib/crm/state";

const client: TgPeer = { id: "66092185", firstName: "Иван", lastName: "Петров", username: "ivan_cafe", phone: "79991234567" };

describe("CRM: переписка рабочего Telegram", () => {
  it("входящее и наш ответ — в одну карточку по Telegram id и телефону", () => {
    const incoming = mapTgMessage(client, { id: 10, out: false, date: 1_762_675_200, text: "Здравствуйте, сколько стоит?" }, "Алексей")!;
    assert.equal(incoming.externalKey, "tguser:66092185:10");
    assert.equal(incoming.channel, "telegram");
    assert.equal(incoming.direction, "in");
    assert.equal(incoming.authorName, null);
    assert.deepEqual(incoming.identity, { telegramChatId: "66092185", phone: "+79991234567", name: "Иван Петров" });
    assert.deepEqual(incoming.occurredAt, new Date(1_762_675_200_000));

    const answer = mapTgMessage(client, { id: 11, out: true, date: 1_762_675_260, text: "Добрый день! Тарифы…" }, "Алексей")!;
    assert.equal(answer.direction, "out");
    assert.equal(answer.authorName, "Алексей");
    assert.equal(computeContactState([incoming, answer]).awaitingSince, null);
    assert.deepEqual(computeContactState([incoming]).awaitingSince, incoming.occurredAt);
  });

  it("вложения подписываются, голосовое — с расшифровкой, пустое не пишется", () => {
    assert.equal(tgMessageBody({ id: 1, out: false, date: 0, media: { kind: "photo" }, text: "Вот журнал" }), "[Фото]\nВот журнал");
    assert.equal(
      tgMessageBody({ id: 2, out: false, date: 0, media: { kind: "voice", durationSec: 23 }, transcript: "Перезвоните мне" }),
      "[Голосовое 0:23]\nРасшифровка: Перезвоните мне",
    );
    assert.equal(mediaLabel({ kind: "document", fileName: "счёт.pdf" }), "[Файл: счёт.pdf]");
    assert.equal(tgMessageBody({ id: 3, out: false, date: 0, text: "   " }), null);
    assert.equal(mapTgMessage(client, { id: 3, out: false, date: 0 }, "x"), null);
  });

  it("боты, «Избранное», удалённые, служебный аккаунт и исключения — мимо CRM", () => {
    const ignore = parseIgnoreList("12345, @Colleague  777");
    assert.equal(isCrmPeer(client, ignore), true);
    assert.equal(isCrmPeer({ ...client, bot: true }, ignore), false);
    assert.equal(isCrmPeer({ ...client, self: true }, ignore), false);
    assert.equal(isCrmPeer({ ...client, deleted: true }, ignore), false);
    assert.equal(isCrmPeer({ id: "777000" }, ignore), false);
    assert.equal(isCrmPeer({ id: "12345" }, ignore), false);
    assert.equal(isCrmPeer({ id: "5", username: "colleague" }, ignore), false);
  });

  it("служебные разборы", () => {
    assert.equal(peerName({ id: "1", username: "nick" }), "@nick");
    assert.equal(tgPhone("79991234567"), "+79991234567");
    assert.equal(tgPhone(null), null);
    assert.deepEqual(parseCursorState('{"1":5,"x":3,"2":-1,"3":7}'), { "1": 5, "3": 7 });
    assert.deepEqual(parseCursorState("испорчено"), {});
    assert.deepEqual(parseSocksProxy("socks5://u:p%40ss@192.168.33.214:2082"), { ip: "192.168.33.214", port: 2082, socksType: 5, username: "u", password: "p@ss" });
    assert.equal(parseSocksProxy("http://proxy:8080"), null);
    assert.equal(parseSocksProxy(""), null);
  });
});
