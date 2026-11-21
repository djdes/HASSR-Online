import assert from "node:assert/strict";
import test from "node:test";

import {
  EXCHANGE_ALERT_MAX_NAMES,
  alertCabinets,
  alertDayStart,
  composeExchangeAlert,
  decideExchangeAlert,
  type AlertCabinet,
} from "@/lib/directory-exchange/alert";

const NOW = new Date("2026-11-21T01:30:00.000Z"); // 04:30 МСК

function cabinet(id: string, extra: Partial<AlertCabinet> = {}): AlertCabinet {
  return { id, name: `Кабинет ${id}`, ownerName: null, ownerEmail: null, problem: "no_success", error: null, lastOkAt: null, ...extra };
}

test("day start: Moscow calendar day (UTC+3)", () => {
  assert.equal(alertDayStart(NOW).toISOString(), "2026-11-20T21:00:00.000Z");
  // 23:59 МСК — ещё те же сутки; 00:00 МСК — новые.
  assert.equal(alertDayStart(new Date("2026-11-21T20:59:59.000Z")).toISOString(), "2026-11-20T21:00:00.000Z");
  assert.equal(alertDayStart(new Date("2026-11-21T21:00:00.000Z")).toISOString(), "2026-11-21T21:00:00.000Z");
});

test("decision: a normal night sends nothing", () => {
  assert.deepEqual(decideExchangeAlert({ cabinets: [], lastSentAt: null, now: NOW }), { send: false, reason: "healthy" });
  assert.deepEqual(decideExchangeAlert({ cabinets: [], lastSentAt: new Date(NOW.getTime() - 3 * 86_400_000), now: NOW }), {
    send: false,
    reason: "healthy",
  });
});

test("decision: problems send once per Moscow day", () => {
  const cabinets = [cabinet("a", { problem: "error", error: "boom" })];
  const first = decideExchangeAlert({ cabinets, lastSentAt: null, now: NOW });
  assert.equal(first.send, true);
  // Отправлено сегодня в 00:10 МСК — сегодня больше нет.
  assert.deepEqual(decideExchangeAlert({ cabinets, lastSentAt: new Date("2026-11-20T21:10:00.000Z"), now: NOW }), {
    send: false,
    reason: "already_sent",
  });
  // Вчера в 04:31 МСК (меньше 24 ч назад) — сегодня ещё можно: плановый обмен не теряет день из-за минут.
  assert.equal(decideExchangeAlert({ cabinets, lastSentAt: new Date("2026-11-20T01:31:00.000Z"), now: NOW }).send, true);
});

test("cabinets: failed in this run join the problems as errors, without duplicates; errors first", () => {
  const old = new Date("2026-11-18T01:00:00.000Z");
  const recent = new Date("2026-11-19T01:00:00.000Z");
  const problems = [
    cabinet("b", { name: "Бета", lastOkAt: recent }),
    cabinet("a", { name: "Альфа", lastOkAt: old }),
    cabinet("c", { name: "Гамма", problem: "error", error: "Мастер-кабинет не найден", lastOkAt: recent }),
  ];
  const failed = [cabinet("b", { name: "Бета" }), cabinet("d", { name: "Дельта" })];
  const result = alertCabinets(problems, failed);
  assert.deepEqual(
    result.map((item) => [item.id, item.problem]),
    [
      ["d", "error"],
      ["b", "error"],
      ["c", "error"],
      ["a", "no_success"],
    ],
  );
  // Ошибка из журнала у кабинета сохраняется.
  assert.equal(result.find((item) => item.id === "c")?.error, "Мастер-кабинет не найден");
  assert.deepEqual(alertCabinets([], []), []);
});

test("text: count, up to 10 names with owners, the rest counted, link to ROOT", () => {
  const cabinets = Array.from({ length: 12 }, (_, index) =>
    cabinet(`id${index}`, {
      name: `Мастер-кабинет ${index + 1}`,
      ownerName: index === 0 ? "Иван <Петров>" : null,
      ownerEmail: index === 0 ? "ivan@example.ru" : null,
      problem: index === 0 ? "error" : "no_success",
      error: index === 0 ? "Invalid `db.room.create()` & co" : null,
      lastOkAt: index === 1 ? new Date("2026-11-19T01:05:00.000Z") : null,
    }),
  );
  const text = composeExchangeAlert(cabinets, "https://wesetup.ru/");
  const lines = text.split("\n");
  assert.equal(lines[0], "<b>Обмен справочниками: 12 кабинетов с проблемой</b>");
  assert.ok(text.includes("• Мастер-кабинет 1 — Иван &lt;Петров&gt; · ivan@example.ru: ошибка «Invalid `db.room.create()` &amp; co»"));
  assert.ok(text.includes("• Мастер-кабинет 2: нет успешного обмена больше суток; последний успешный — 19.11 04:05 МСК"));
  assert.ok(text.includes("успешного обмена не было"));
  assert.equal(lines.filter((line) => line.startsWith("• ")).length, EXCHANGE_ALERT_MAX_NAMES);
  assert.ok(!text.includes("Мастер-кабинет 11"));
  assert.ok(text.includes("… и ещё 2"));
  assert.ok(text.endsWith('<a href="https://wesetup.ru/root/directory-exchange">Открыть «Обмен справочниками»</a>'));

  const one = composeExchangeAlert([cabinet("x", { name: "Один" })], "https://wesetup.ru");
  assert.ok(one.startsWith("<b>Обмен справочниками: 1 кабинет с проблемой</b>"));
  assert.ok(!one.includes("и ещё"));
  assert.ok(composeExchangeAlert([cabinet("x"), cabinet("y")], "https://x").startsWith("<b>Обмен справочниками: 2 кабинета"));
});
