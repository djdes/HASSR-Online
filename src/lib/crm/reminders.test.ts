import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  composeDigest,
  composeNewMailAlert,
  composeReminder,
  isDigestTime,
  isWorkingTime,
  moscowDateKey,
  planReminders,
  type ReminderContact,
} from "@/lib/crm/reminders";

// 12:00 по Москве = 09:00 UTC.
const noon = new Date("2026-11-07T09:00:00Z");
const minutesAgo = (m: number) => new Date(noon.getTime() - m * 60_000);
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function contact(overrides: Partial<ReminderContact> = {}): ReminderContact {
  return {
    id: "c1",
    name: "Иван",
    company: "Кафе «Ромашка»",
    email: "ivan@romashka.ru",
    phone: "+7 912 345-67-89",
    stage: "new",
    ownerId: null,
    awaitingSince: null,
    awaitingChannel: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    nextActionAt: null,
    nextActionNote: null,
    ...overrides,
  };
}

describe("CRM: напоминания", () => {
  it("рабочее время по Москве 9–21 и ключ даты", () => {
    assert.equal(isWorkingTime(new Date("2026-11-07T05:59:00Z")), false); // 08:59 МСК
    assert.equal(isWorkingTime(new Date("2026-11-07T06:00:00Z")), true); // 09:00 МСК
    assert.equal(isWorkingTime(new Date("2026-11-07T17:59:00Z")), true); // 20:59 МСК
    assert.equal(isWorkingTime(new Date("2026-11-07T18:00:00Z")), false); // 21:00 МСК
    assert.equal(isDigestTime(new Date("2026-11-07T06:05:00Z")), true);
    assert.equal(moscowDateKey(new Date("2026-11-07T22:30:00Z")), "2026-11-08");
  });

  it("ночью ничего не шлём — напоминание дождётся утра", () => {
    const night = new Date("2026-11-07T00:00:00Z");
    assert.deepEqual(planReminders([contact({ awaitingSince: new Date(night.getTime() - 60 * 60_000), awaitingChannel: "email" })], night), []);
  });

  it("нет ответа: 30 минут — первый шаг, 4 часа — эскалация, 7 дней — молчим", () => {
    assert.deepEqual(planReminders([contact({ awaitingSince: minutesAgo(29), awaitingChannel: "email" })], noon), []);
    const first = planReminders([contact({ awaitingSince: minutesAgo(31), awaitingChannel: "email" })], noon);
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, "unanswered");
    assert.equal(first[0].toHeads, true, "ответственного нет — РОП");
    assert.equal(first[0].dedupeKey, `crm:unanswered:c1:${minutesAgo(31).toISOString()}`);
    const owned = planReminders([contact({ ownerId: "u1", awaitingSince: minutesAgo(31), awaitingChannel: "email" })], noon);
    assert.equal(owned[0].toHeads, false, "есть ответственный — первый шаг только ему");
    const escalation = planReminders([contact({ ownerId: "u1", awaitingSince: minutesAgo(241), awaitingChannel: "email" })], noon);
    assert.deepEqual(escalation.map((item) => [item.kind, item.toOwner, item.toHeads]), [["escalation", true, true]]);
    assert.deepEqual(planReminders([contact({ awaitingSince: minutesAgo(8 * 24 * 60), awaitingChannel: "email" })], noon), []);
  });

  it("онлайн-чат: первый шаг пропускаем (там свой сигнал), эскалация остаётся", () => {
    assert.deepEqual(planReminders([contact({ awaitingSince: minutesAgo(40), awaitingChannel: "chat" })], noon), []);
    assert.equal(planReminders([contact({ awaitingSince: minutesAgo(300), awaitingChannel: "chat" })], noon)[0].kind, "escalation");
  });

  it("спам и отказ — без напоминаний", () => {
    for (const stage of ["spam", "lost"]) {
      assert.deepEqual(planReminders([contact({ stage, awaitingSince: minutesAgo(300), awaitingChannel: "email", nextActionAt: minutesAgo(1) })], noon), []);
    }
  });

  it("следующий шаг: в срок и неделю после, ключ от даты шага", () => {
    assert.deepEqual(planReminders([contact({ nextActionAt: new Date(noon.getTime() + 60_000) })], noon), []);
    const due = planReminders([contact({ ownerId: "u1", nextActionAt: minutesAgo(5), nextActionNote: "Позвонить" })], noon);
    assert.deepEqual(due.map((item) => [item.kind, item.toOwner, item.toHeads]), [["next_action", true, false]]);
    assert.equal(due[0].dedupeKey, `crm:next:c1:${minutesAgo(5).toISOString()}`);
    assert.deepEqual(planReminders([contact({ nextActionAt: minutesAgo(8 * 24 * 60) })], noon), []);
  });

  it("клиент молчит 3 дня после нашего ответа — если шаг не назначен и это лид", () => {
    const silent = contact({ lastOutboundAt: minutesAgo(3 * 24 * 60 + 1), lastInboundAt: minutesAgo(4 * 24 * 60) });
    assert.equal(planReminders([silent], noon)[0].kind, "silent");
    assert.deepEqual(planReminders([{ ...silent, nextActionAt: new Date(noon.getTime() + 86_400_000) }], noon), []);
    assert.deepEqual(planReminders([{ ...silent, stage: "won" }], noon), [], "клиент молчит — это нормально");
    assert.deepEqual(planReminders([{ ...silent, lastOutboundAt: minutesAgo(2 * 24 * 60) }], noon), []);
    assert.deepEqual(planReminders([{ ...silent, lastOutboundAt: minutesAgo(15 * 24 * 60), lastInboundAt: null }], noon), []);
  });

  it("тексты: экранирование, ссылка на карточку, тема письма", () => {
    const reminder = composeReminder({
      kind: "escalation",
      contact: contact({ name: "<Иван>", awaitingSince: minutesAgo(300), awaitingChannel: "email" }),
      now: noon,
      appUrl: "https://wesetup.ru",
      ownerName: null,
      escape,
    });
    assert.match(reminder.text, /Клиент ждёт ответа 5 ч/);
    assert.match(reminder.text, /&lt;Иван&gt;/);
    assert.match(reminder.text, /Канал: Почта\. Ответственный: не назначен/);
    assert.match(reminder.text, /href="https:\/\/wesetup\.ru\/root\/crm\/contacts\/c1"/);
    assert.match(reminder.subject, /^CRM: Клиент ждёт ответа 5 ч — <Иван>/);
    const next = composeReminder({ kind: "next_action", contact: contact({ nextActionNote: "Отправить КП" }), now: noon, appUrl: "", escape });
    assert.match(next.text, /Шаг: Отправить КП/);
  });

  it("сводка и письмо-уведомление", () => {
    const digest = composeDigest(
      { dateLabel: "7 ноября", awaiting: 3, overdue: 1, newLeads: 4, newByChannel: [{ channel: "email", count: 3 }, { channel: "demo", count: 1 }], nextToday: 2, nextOverdue: 0, silent: 1, filtered: 5 },
      "https://wesetup.ru",
      escape,
    );
    assert.match(digest.text, /Ждут ответа: <b>3<\/b> \(дольше 4 ч — 1\)/);
    assert.match(digest.text, /Почта — 3, Показ за 15 минут — 1/);
    assert.match(digest.text, /Отсеяно писем за сутки: 5/);
    assert.equal(digest.subject, "CRM: сводка на 7 ноября");
    const calm = composeDigest({ dateLabel: "8 ноября", awaiting: 0, overdue: 0, newLeads: 0, newByChannel: [], nextToday: 0, nextOverdue: 0, silent: 0, filtered: 0 }, "", escape);
    assert.match(calm.text, /Очередь разобрана/);
    const alert = composeNewMailAlert({ contactId: "c9", isNewContact: true, fromName: "Иван", fromAddress: "i@x.ru", subject: "Цена", preview: "Сколько стоит?", appUrl: "https://wesetup.ru", escape });
    assert.match(alert.text, /Новое обращение на почту/);
    assert.match(alert.text, /Иван &lt;i@x\.ru&gt;/);
  });
});
