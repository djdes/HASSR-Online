import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayPhone, formatCallDuration, parseByteRange, formatTranscript, mapTelphinCall, shortExtension, telphinQueryTime, telphinTime, type TelphinCall } from "@/lib/crm/telphin";
import { computeContactState } from "@/lib/crm/state";

const names = new Map([
  ["101", "Денис"],
  ["103", "Алексей"],
]);

/** Входящий через голосовое меню и очередь, взял 101 — как в живой истории Телфина. */
const incoming: TelphinCall = {
  call_uuid: "04A68E0F",
  flow: "in",
  result: "bridged",
  init_time_gmt: "2026-10-29 07:38:19",
  duration: 23,
  bridged_duration: 17,
  from_username: "+79250008609",
  from_screen_name: "+79250008609",
  to_username: "74951096070",
  bridged_username: "17536*101",
  cdr: [
    { flow: "in", extension_name: "17536*101@sipproxy.telphin.ru", result: "answered", duration: 17, record_uuid: "1289540-0728", record_file_size: 70000 },
    { flow: "in", extension_name: "17536*099@sipproxy.telphin.ru", result: "answered", duration: 23, record_uuid: null },
    { flow: "transfer", extension_name: "17536*099@sipproxy.telphin.ru", result: "answered", duration: 5, record_uuid: null },
  ],
};

const outgoing: TelphinCall = {
  call_uuid: "6BCEA466",
  flow: "out",
  result: "bridged",
  init_time_gmt: "2026-11-04 08:49:13.93",
  duration: 136,
  from_username: "17536*103",
  from_screen_name: "Алексей",
  to_username: "89939173279",
  cdr: [{ flow: "out", extension_name: "17536*103@sipproxy.telphin.ru", result: "answered", duration: 136, record_uuid: "1289546-6BCE", record_file_size: 545472 }],
};

describe("CRM: звонки Телфина", () => {
  it("входящий разговор: клиент по номеру, сотрудник из добавочного, запись с плеча", () => {
    const mapped = mapTelphinCall(incoming, names)!;
    assert.equal(mapped.item.externalKey, "telphin:04A68E0F");
    assert.equal(mapped.item.channel, "call");
    assert.equal(mapped.item.direction, "in");
    assert.equal(mapped.item.identity.phone, "+79250008609");
    assert.equal(mapped.item.authorName, "Денис");
    assert.deepEqual(mapped.item.occurredAt, new Date("2026-10-29T07:38:19Z"));
    assert.match(mapped.item.body, /Входящий звонок, 17 с/);
    assert.match(mapped.item.body, /Сотрудник: Денис \(доб\. 101\)/);
    assert.equal(mapped.recording.recordUuid, "1289540-0728");
    assert.equal(mapped.recording.extension, "101");
    assert.equal(mapped.recording.durationSec, 17);
  });

  it("исходящий: номер в формате 8… приводится к +7, длительность разговора", () => {
    const mapped = mapTelphinCall(outgoing, names)!;
    assert.equal(mapped.item.channel, "call");
    assert.equal(mapped.item.direction, "out");
    assert.equal(mapped.recording.clientNumber, "+79939173279");
    assert.equal(mapped.item.authorName, "Алексей");
    assert.match(mapped.item.body, /Исходящий звонок, 2 мин 16 с/);
    assert.equal(mapped.recording.recordUuid, "1289546-6BCE");
  });

  it("пропущенный входящий ждёт ответа, недозвон — не ответ клиенту", () => {
    const missed = mapTelphinCall({ ...incoming, result: "not answered", bridged_username: null, cdr: [] }, names)!;
    assert.equal(missed.item.channel, "missed_call");
    assert.equal(missed.item.direction, "in");
    assert.equal(missed.recording.recordUuid, null);
    const attempt = mapTelphinCall({ ...outgoing, call_uuid: "X", result: "not answered", init_time_gmt: "2026-10-29 08:00:00", cdr: [] }, names)!;
    assert.equal(attempt.item.channel, "call_attempt");
    assert.equal(attempt.item.direction, "event");

    const state = computeContactState([missed.item, attempt.item]);
    assert.deepEqual(state.awaitingSince, missed.item.occurredAt);
    // Перезвонили и поговорили — ответ есть.
    const answered = mapTelphinCall({ ...outgoing, init_time_gmt: "2026-10-29 09:00:00" }, names)!;
    assert.equal(computeContactState([missed.item, attempt.item, answered.item]).awaitingSince, null);
  });

  it("принятый входящий звонок сам по себе — уже разговор, ответа не ждёт", () => {
    const mapped = mapTelphinCall(incoming, names)!;
    assert.equal(computeContactState([mapped.item]).awaitingSince, null);
  });

  it("переадресация на мобильный: сотрудник — добавочный, чьё плечо разговаривало", () => {
    const forwarded = mapTelphinCall(
      {
        ...incoming,
        bridged_username: "+79250008609",
        cdr: [
          { flow: "in", extension_name: "17536*101@sipproxy.telphin.ru", extension_type: "phone", result: "answered", duration: 0 },
          { flow: "transfer", extension_name: "17536*101@sipproxy.telphin.ru", extension_type: "phone", result: "answered", duration: 119 },
          { flow: "in", extension_name: "17536*099@sipproxy.telphin.ru", extension_type: "ivr", result: "answered", duration: 125 },
        ],
      },
      names,
    )!;
    assert.equal(forwarded.recording.extension, "101");
    assert.equal(forwarded.item.authorName, "Денис");
    assert.equal(forwarded.recording.recordUuid, null);
    assert.match(forwarded.item.body, /Записи нет/);
  });

  it("внутренние звонки и звонки без номера пропускаются", () => {
    assert.equal(mapTelphinCall({ ...outgoing, to_username: "17536*101" }, names), null);
    assert.equal(mapTelphinCall({ ...incoming, from_username: null }, names), null);
    assert.equal(mapTelphinCall({ ...incoming, flow: "internal" }, names), null);
  });

  it("служебные форматы", () => {
    assert.equal(shortExtension("17536*101@sipproxy.telphin.ru"), "101");
    assert.equal(shortExtension("74951096070"), null);
    assert.equal(displayPhone("74951096543"), "+74951096543");
    assert.equal(displayPhone("+375291234567"), "+375291234567");
    assert.equal(formatCallDuration(45), "45 с");
    assert.equal(formatCallDuration(120), "2 мин");
    assert.equal(telphinQueryTime(telphinTime("2026-11-04 16:36:11")), "2026-11-04 16:36:11");
    assert.equal(formatTranscript("  Алло, да.  Здравствуйте! Как дела? хорошо "), "Алло, да.\nЗдравствуйте!\nКак дела? хорошо");
  });

  it("Range плеера", () => {
    assert.equal(parseByteRange(null, 1000), null);
    assert.deepEqual(parseByteRange("bytes=0-", 1000), { start: 0, end: 999 });
    assert.deepEqual(parseByteRange("bytes=100-199", 1000), { start: 100, end: 199 });
    assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
    assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
    assert.equal(parseByteRange("bytes=1000-", 1000), "invalid");
    assert.equal(parseByteRange("bytes=5-1", 1000), "invalid");
    assert.equal(parseByteRange("items=0-1", 1000), "invalid");
  });
});
