import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { composeDemoAlert, composeDemoComment, type DemoRequest } from "@/lib/demo-request";
import { DEMO_SLOTS, demoIcs, demoSlotDays, formatDayKey, formatSlotDay, formatSlotTime, isBookableSlot } from "@/lib/demo-slots";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("запись на показ: слоты", () => {
  it("будни 10:00–17:30 по Москве, шаг 30 минут, не раньше чем через 2 часа, 5 рабочих дней", () => {
    // Пятница 30.10.2026, 13:10 МСК.
    const now = new Date("2026-10-30T10:10:00Z");
    const days = demoSlotDays(now);
    assert.deepEqual(days.map((day) => day.key), ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    // Сегодня — с 15:30 МСК (13:10 + 2 ч → первый слот 15:30).
    assert.equal(days[0].slots[0], "2026-10-30T12:30:00.000Z");
    assert.equal(days[0].slots.at(-1), "2026-10-30T14:30:00.000Z");
    // Полный день: 16 слотов с 10:00 до 17:30 МСК.
    assert.equal(days[1].slots.length, 16);
    assert.equal(days[1].slots[0], "2026-11-02T07:00:00.000Z");
    assert.equal(days[1].slots.at(-1), "2026-11-02T14:30:00.000Z");
    assert.equal(DEMO_SLOTS.leadMinutes, 120);
  });

  it("вечером сегодня не показываем; занятое скрыто; запись — только на свободный слот", () => {
    // Пятница 30.10.2026, 17:00 МСК — сегодня слотов уже нет.
    const evening = new Date("2026-10-30T14:00:00Z");
    const taken = new Set(["2026-11-02T07:00:00.000Z"]);
    const days = demoSlotDays(evening, taken);
    assert.equal(days[0].key, "2026-11-02");
    assert.equal(days[0].slots.includes("2026-11-02T07:00:00.000Z"), false);
    assert.equal(isBookableSlot("2026-11-02T07:00:00.000Z", evening, taken), false);
    assert.equal(isBookableSlot("2026-11-02T07:30:00.000Z", evening, taken), true);
    // Не по сетке, в выходной и вне часов — нельзя.
    assert.equal(isBookableSlot("2026-11-02T07:10:00.000Z", evening), false);
    assert.equal(isBookableSlot("2026-10-31T07:00:00.000Z", evening), false);
    assert.equal(isBookableSlot("2026-11-02T15:00:00.000Z", evening), false);
    assert.equal(isBookableSlot("не время", evening), false);
  });

  it("подписи по Москве, приглашение в календарь, тексты админу", () => {
    assert.equal(formatSlotTime("2026-11-02T08:30:00.000Z"), "11:30");
    assert.match(formatSlotDay("2026-11-02T08:30:00.000Z", "ru"), /2 ноября/);
    assert.match(formatDayKey("2026-11-02", "ru"), /пн/);
    const ics = demoIcs({ slot: "2026-11-02T08:30:00.000Z", uid: "demo-1", summary: "Показ, WeSetup", description: "Строка 1\nСтрока 2", now: new Date("2026-11-01T10:00:00Z") });
    assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(ics, /DTSTART:20261102T083000Z\r\nDTEND:20261102T090000Z\r\n/);
    assert.match(ics, /SUMMARY:Показ\\, WeSetup\r\n/);
    assert.match(ics, /DESCRIPTION:Строка 1\\nСтрока 2\r\n/);
    const request: DemoRequest = {
      name: "Анна",
      phone: "+7 999 111-22-33",
      when: null,
      slot: "2026-11-02T08:30:00.000Z",
      email: "anna@x.ru",
      topic: null,
      place: "pricing",
      source: null,
      organizationName: null,
    };
    assert.match(composeDemoAlert(request, escape), /^<b>📅 Показ за 15 минут: пн, 2 ноября, 11:30 \(МСК\)<\/b>/);
    assert.match(composeDemoAlert(request, escape), /· anna@x\.ru/);
    assert.match(composeDemoComment(request), /^Записались на: пн, 2 ноября, 11:30 \(МСК\)\nПочта: anna@x\.ru/);
    assert.match(composeDemoComment({ ...request, slot: null, when: "today" }), /^Когда удобно: сегодня/);
  });

  it("сервер: слот под замком, занятое — 409, приглашение письмом; окно — выбор времени", () => {
    const route = read("src/app/api/demo-request/route.ts");
    assert.match(route, /pg_advisory_xact_lock\(hashtext\(\$\{`demo-slot:\$\{slot\}`\}\)\)/);
    assert.match(route, /if \(!isBookableSlot\(slot, now, takenKeys\)\) throw new SlotTakenError\(\);/);
    assert.match(route, /code: "slot-taken" \}, \{ status: 409 \}/);
    assert.match(route, /scheduledAt: slot \? new Date\(slot\) : null/);
    assert.match(route, /filename: "wesetup-demo\.ics"/);
    assert.match(read("prisma/schema.prisma"), /scheduledAt\s+DateTime\?/);
    const dialog = read("src/components/public/demo-request-button.tsx");
    assert.match(dialog, /fetch\("\/api\/demo-request\/slots"/);
    assert.match(dialog, /mode === "slot" \? \{ slot, email: email\.trim\(\) \|\| undefined \} : \{ when \}/);
    assert.match(dialog, /download="wesetup-demo\.ics"/);
    // Телефон: строка дней прокручивается, а не растягивает окно; месяц — строчной.
    assert.match(dialog, /<form onSubmit=\{submit\} noValidate className="min-w-0 space-y-4">/);
    assert.match(dialog, /\{upperFirst\(formatDayKey\(day\.key, locale\)\)\}/);
    assert.doesNotMatch(dialog, /font-medium capitalize/);
    // Липкая шапка окна закрывает и верхний отступ (полоса над ней не просвечивает).
    assert.match(read("src/components/ui/dialog.tsx"), /\[\.p-6_&\]:sticky \[\.p-6_&\]:-top-6 /);
  });
});
