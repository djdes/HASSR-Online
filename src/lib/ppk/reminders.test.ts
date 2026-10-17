import test from "node:test";
import assert from "node:assert/strict";

import { buildPpkReminderKeyboard, collectPpkReminders, daysBetween, isReminderDay, ppkDueSoon, ppkReminderMessage } from "./reminders";
import type { LabPlanItem, PestPlanItem } from "./records";

const TODAY = "2026-10-17";

function lab(over: Partial<LabPlanItem>): LabPlanItem {
  return { object: "water", subject: "Питьевая вода", indicator: "", everyMonths: 1, laboratory: "", lastDate: null, ...over };
}
function pest(over: Partial<PestPlanItem>): PestPlanItem {
  return { kind: "deratization", object: "Склад", frequency: "", contractor: "", lastDate: null, nextDate: null, ...over };
}

test("isReminderDay: за 7, 3, 1 день, в день срока, просрочка на 1-й день и каждые 7 дней", () => {
  const yes = [7, 3, 1, 0, -1, -7, -14];
  const no = [8, 4, 2, -2, -8];
  for (const d of yes) assert.equal(isReminderDay(d), true, `daysLeft=${d}`);
  for (const d of no) assert.equal(isReminderDay(d), false, `daysLeft=${d}`);
});

test("daysBetween: целые дни между датами, в том числе через месяц и год", () => {
  assert.equal(daysBetween("2026-10-17", "2026-10-20"), 3);
  assert.equal(daysBetween("2026-10-17", "2026-10-17"), 0);
  assert.equal(daysBetween("2026-10-17", "2026-10-10"), -7);
  assert.equal(daysBetween("2026-12-30", "2027-01-02"), 3);
});

test("collectPpkReminders: лаборатория без lastDate пропускается", () => {
  const out = collectPpkReminders({ lab: [lab({ lastDate: null })], pest: [], today: TODAY });
  assert.deepEqual(out, []);
});

test("collectPpkReminders: пункт через 3 дня попадает, через 5 — нет", () => {
  const out = collectPpkReminders({
    lab: [],
    pest: [pest({ nextDate: "2026-10-20" }), pest({ object: "Цех", nextDate: "2026-10-22" })],
    today: TODAY,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].daysLeft, 3);
  assert.equal(out[0].block, "pest");
});

test("collectPpkReminders: просрочка 1 и 7 дней попадает, 2 — нет", () => {
  const mk = (d: string) => pest({ object: d, nextDate: d });
  const out = collectPpkReminders({
    lab: [],
    pest: [mk("2026-10-16"), mk("2026-10-15"), mk("2026-10-10")],
    today: TODAY,
  });
  assert.deepEqual(out.map((i) => i.daysLeft), [-7, -1]);
});

test("collectPpkReminders: лаборатория считает дату от lastDate; заголовки пунктов", () => {
  const out = collectPpkReminders({
    lab: [lab({ lastDate: "2026-09-20", everyMonths: 1, indicator: "микробиология" })],
    pest: [pest({ kind: "disinsection", object: "Кухня", nextDate: "2026-10-17" })],
    today: TODAY,
  });
  assert.equal(out.length, 2);
  const labItem = out.find((i) => i.block === "lab")!;
  assert.equal(labItem.title, "Вода: Питьевая вода — микробиология");
  assert.equal(labItem.nextDate, "2026-10-20");
  assert.equal(labItem.daysLeft, 3);
  const pestItem = out.find((i) => i.block === "pest")!;
  assert.equal(pestItem.title, "Дезинсекция: Кухня");
});

test("collectPpkReminders: просроченные сверху, затем по дате", () => {
  const out = collectPpkReminders({
    lab: [],
    pest: [
      pest({ object: "a", nextDate: "2026-10-24" }),
      pest({ object: "b", nextDate: "2026-10-18" }),
      pest({ object: "c", nextDate: "2026-10-16" }),
    ],
    today: TODAY,
  });
  assert.deepEqual(out.map((i) => i.daysLeft), [-1, 1, 7]);
});

test("ppkReminderMessage: экранирует разметку, статусы и пустые секции", () => {
  const msg = ppkReminderMessage([
    { recordId: "r1", block: "pest", title: "Дератизация: <Склад>", nextDate: "2026-10-16", daysLeft: -1 },
    { recordId: "r1", block: "pest", title: "Дезинфекция: Зал", nextDate: "2026-10-17", daysLeft: 0 },
    { recordId: "r1", block: "pest", title: "Дезинсекция: Кухня", nextDate: "2026-10-18", daysLeft: 1 },
    { recordId: "r1", block: "pest", title: "Дезинсекция: Бар", nextDate: "2026-10-24", daysLeft: 7 },
  ]);
  assert.match(msg, /^🔔 <b>Производственный контроль: сроки<\/b>/);
  assert.ok(msg.includes("Дератизация: &lt;Склад&gt; — просрочено на 1 дн. (16.10)"));
  assert.ok(msg.includes("— сегодня (17.10)"));
  assert.ok(msg.includes("— завтра (18.10)"));
  assert.ok(msg.includes("— через 7 дн. (24.10)"));
  assert.ok(msg.includes("🪲 <b>Дезинсекция и дератизация</b>"));
  assert.ok(!msg.includes("🧪"));
  assert.ok(msg.endsWith("Нажмите ✅, когда выполнено — отметим и посчитаем следующий срок."));
});

test("ppkDueSoon: всё просроченное и всё в пределах 7 дней, без правила дней напоминания", () => {
  const mk = (d: string) => pest({ object: d, nextDate: d });
  const out = ppkDueSoon({
    lab: [],
    pest: [mk("2026-10-24"), mk("2026-10-25"), mk("2026-10-19"), mk("2026-10-02"), mk("2026-10-15")],
    today: TODAY,
  });
  // 8 дней вперёд не попадает; просроченные сверху, затем по дате
  assert.deepEqual(out.map((i) => i.daysLeft), [-15, -2, 2, 7]);
  assert.deepEqual(ppkDueSoon({ lab: [], pest: [mk("2026-10-25")], today: TODAY }, 10).map((i) => i.daysLeft), [8]);
});

test("ppkDueSoon: лаборатория без lastDate пропускается, заголовки как в напоминаниях", () => {
  const out = ppkDueSoon({
    lab: [lab({ lastDate: null }), lab({ lastDate: "2026-09-20", indicator: "микробиология" })],
    pest: [],
    today: TODAY,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Вода: Питьевая вода — микробиология");
});

test("buildPpkReminderKeyboard: кнопки ✅ с recordId, обрезка заголовка, «Открыть план» последней", () => {
  const long = "Вода: очень длинное название пункта плана для проверки";
  const items = [
    { recordId: "abc1234567890", block: "lab" as const, title: long, nextDate: TODAY, daysLeft: 0 },
    { recordId: "def1234567890", block: "pest" as const, title: "Кухня", nextDate: TODAY, daysLeft: 0 },
  ];
  const kb = buildPpkReminderKeyboard(items, "https://x/y");
  assert.equal(kb.inline_keyboard.length, 3);
  const first = kb.inline_keyboard[0][0] as { text: string; callback_data: string };
  assert.equal(first.callback_data, "ppk:done:abc1234567890");
  assert.ok(first.text.startsWith("✅ ") && first.text.endsWith("…") && first.text.length <= 32);
  assert.deepEqual(kb.inline_keyboard[2][0], { text: "Открыть план", web_app: { url: "https://x/y" } });
  assert.equal(buildPpkReminderKeyboard(items, null).inline_keyboard.length, 2);
});

test("buildPpkReminderKeyboard: не больше 8 кнопок пунктов", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ recordId: `id${String(i).padStart(10, "0")}`, block: "pest" as const, title: `П${i}`, nextDate: TODAY, daysLeft: 0 }));
  assert.equal(buildPpkReminderKeyboard(items, null).inline_keyboard.length, 8);
});

test("ppkReminderMessage: подсказка про ✅", () => {
  assert.match(ppkReminderMessage([]), /Нажмите ✅, когда выполнено/);
});
