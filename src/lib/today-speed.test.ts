import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dayDeadline, dayLeft } from "@/lib/day-deadline";
import { RECENT_JOURNALS_MAX, parseRecentJournals, pickRecentJournals, pushRecentJournal } from "@/lib/recent-journals";

describe("«До конца дня»", () => {
  it("по умолчанию (0) — до полуночи в часовом поясе организации", () => {
    // 20:40 по Москве = 17:40 UTC.
    const now = new Date("2026-11-08T17:40:00Z");
    const { deadline, label } = dayDeadline({ timezone: "Europe/Moscow", shiftEndHour: 0, now });
    assert.equal(deadline.toISOString(), "2026-11-08T21:00:00.000Z");
    assert.equal(label, "00:00");
    assert.deepEqual(dayLeft(deadline, now), { kind: "open", hours: 3, minutes: 20, urgent: false });
  });

  it("23:00 — граница того же дня; меньше часа — срочно; после — закрыт", () => {
    const { deadline, label } = dayDeadline({ timezone: "Europe/Moscow", shiftEndHour: 23, now: new Date("2026-11-08T19:15:00Z") });
    assert.equal(deadline.toISOString(), "2026-11-08T20:00:00.000Z");
    assert.equal(label, "23:00");
    assert.deepEqual(dayLeft(deadline, new Date("2026-11-08T19:15:00Z")), { kind: "open", hours: 0, minutes: 45, urgent: true });
    assert.deepEqual(dayLeft(deadline, new Date("2026-11-08T20:30:00Z")), { kind: "closed" });
  });

  it("другой часовой пояс и мусор в часе", () => {
    // Ташкент UTC+5: 10:00 местного = 05:00 UTC, полночь — 19:00 UTC.
    const now = new Date("2026-11-08T05:00:00Z");
    assert.equal(dayDeadline({ timezone: "Asia/Tashkent", shiftEndHour: 0, now }).deadline.toISOString(), "2026-11-08T19:00:00.000Z");
    assert.equal(dayDeadline({ timezone: "Asia/Tashkent", shiftEndHour: 99, now }).label, "00:00");
    assert.equal(dayDeadline({ timezone: null, shiftEndHour: null, now }).label, "00:00");
    // Минуты округляются вверх: 30 секунд — «1 мин».
    assert.deepEqual(dayLeft(new Date(now.getTime() + 30_000), now), { kind: "open", hours: 0, minutes: 1, urgent: true });
  });
});

describe("«Недавно открывали»", () => {
  it("свежие первыми, без повторов, не больше лимита", () => {
    let list: string[] = [];
    for (const code of ["hygiene", "cleaning", "fryer_oil", "hygiene"]) list = pushRecentJournal(list, code);
    assert.deepEqual(list, ["hygiene", "fryer_oil", "cleaning"]);
    for (let index = 0; index < 20; index += 1) list = pushRecentJournal(list, `j${index}`);
    assert.equal(list.length, RECENT_JOURNALS_MAX);
    assert.equal(list[0], "j19");
  });

  it("мусор в хранилище — пустой список; чужие коды отбрасываются", () => {
    assert.deepEqual(parseRecentJournals(null), []);
    assert.deepEqual(parseRecentJournals("{"), []);
    assert.deepEqual(parseRecentJournals('{"a":1}'), []);
    assert.deepEqual(parseRecentJournals('["hygiene", 5, "<script>", "hygiene", "cleaning"]'), ["hygiene", "cleaning"]);
    assert.deepEqual(pushRecentJournal(["hygiene"], "../etc"), ["hygiene"]);
  });

  it("на «Сегодня» — только журналы из списка, до 4, в порядке недавности", () => {
    const items = ["a", "b", "c", "d", "e"].map((code) => ({ code }));
    assert.deepEqual(pickRecentJournals(["x", "c", "a", "e", "d", "b"], items).map((item) => item.code), ["c", "a", "e", "d"]);
    assert.deepEqual(pickRecentJournals([], items), []);
  });
});

import { TODAY_PRINT_MAX, parsePrintCodes } from "@/lib/today-print";
import { isTypingTarget, HOTKEYS } from "@/lib/hotkeys";

describe("Лист «Что заполнить сегодня»", () => {
  it("только коды журналов, без повторов, порядок сохранён, лимит", () => {
    assert.deepEqual(parsePrintCodes("hygiene,cleaning,hygiene, fryer_oil ,<b>,../x"), ["hygiene", "cleaning", "fryer_oil"]);
    assert.deepEqual(parsePrintCodes(["a,b", "c"]), ["a", "b", "c"]);
    assert.deepEqual(parsePrintCodes(undefined), []);
    assert.equal(parsePrintCodes(Array.from({ length: 300 }, (_, index) => `j${index}`).join(",")).length, TODAY_PRINT_MAX);
  });
});

describe("Горячие клавиши", () => {
  it("в полях ввода одиночные клавиши не перехватываются", () => {
    assert.equal(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
    assert.equal(isTypingTarget({ tagName: "textarea" } as unknown as EventTarget), true);
    assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
    assert.equal(isTypingTarget({ tagName: "DIV", getAttribute: () => "combobox" } as unknown as EventTarget), true);
    assert.equal(isTypingTarget({ tagName: "BUTTON", getAttribute: () => null } as unknown as EventTarget), false);
    assert.equal(isTypingTarget(null), false);
  });

  it("в окне «?» — палитра, поиск, срочный журнал и сама подсказка", () => {
    assert.deepEqual(HOTKEYS.map((hotkey) => hotkey.id), ["palette", "search", "urgent", "help"]);
  });
});
