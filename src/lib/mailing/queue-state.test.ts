import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emailForecastLimits, humanMsk, planQueue } from "@/lib/mailing/forecast";
import { queueVerdict, summarizeQueue } from "@/lib/mailing/queue-state";

// 29.09.2026 12:00 МСК.
const NOW = new Date("2026-09-29T09:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

describe("прогноз окончания очереди", () => {
  it("укладывается в текущий час — конец через минуты", () => {
    const f = planQueue(50, NOW, { perHour: 600, perDay: 10_000, usedToday: 0, windowStart: 0, windowEnd: 24 });
    assert.equal(f.finishAt?.toISOString(), "2026-09-29T09:05:00.000Z");
    assert.deepEqual(f.days, [{ date: "2026-09-29", count: 50 }]);
  });

  it("суточный лимит и окно переносят остаток на завтра", () => {
    // Окно 09–21 МСК, 100 в час, 500 в сутки, сегодня уже 400: сегодня ещё 100.
    const f = planQueue(300, NOW, { perHour: 100, perDay: 500, usedToday: 400, windowStart: 9, windowEnd: 21 });
    assert.deepEqual(f.days, [
      { date: "2026-09-29", count: 100 },
      { date: "2026-09-30", count: 200 },
    ]);
    // Завтра с 09:00 МСК — два часа по 100.
    assert.equal(f.finishAt?.toISOString(), "2026-09-30T08:00:00.000Z");
    assert.equal(f.perDay, 500);
  });

  it("ночью ждёт утра; пропускная способность в сутки — с учётом окна", () => {
    const night = new Date("2026-09-29T20:00:00Z"); // 23:00 МСК
    const f = planQueue(10, night, { perHour: 100, perDay: 100_000, usedToday: 0, windowStart: 9, windowEnd: 21 });
    assert.equal(f.finishAt?.toISOString(), "2026-09-30T06:06:00.000Z");
    assert.equal(f.perDay, 1200);
  });

  it("лимит в час не больше лимита в минуту × 60", () => {
    const l = emailForecastLimits({ perMinute: 5, perHour: 1000, perDay: 2000 }, 10, { windowStart: 9, windowEnd: 21 });
    assert.equal(l.perHour, 300);
    assert.equal(l.usedToday, 10);
  });

  it("пусто — без конца; подписи по Москве", () => {
    assert.equal(planQueue(0, NOW, { perHour: 1, perDay: 1, usedToday: 0, windowStart: 0, windowEnd: 24 }).finishAt, null);
    assert.equal(humanMsk("2026-11-12T15:40:00Z"), "12 ноя, 18:40");
  });
});

describe("состояние очереди", () => {
  it("группы по причине и план по часам", () => {
    const s = summarizeQueue(
      [
        { waitReason: "quiet_hours", nextAttemptAt: hours(21), emailQueued: true },
        { waitReason: "quiet_hours", nextAttemptAt: hours(21), emailQueued: true },
        { waitReason: "global_limit", nextAttemptAt: null, emailQueued: true },
        // Время пришло — причина уже не держит, ждёт прохода.
        { waitReason: "domain_limit", nextAttemptAt: hours(-1), emailQueued: false },
      ],
      NOW
    );
    assert.equal(s.total, 4);
    assert.equal(s.emailWaiting, 3);
    assert.deepEqual(
      s.waiting.map((g) => [g.reason, g.count]),
      [
        ["quiet_hours", 2],
        ["global_limit", 1],
        [null, 1],
      ]
    );
    assert.deepEqual(s.plan, [
      { hour: "2026-09-29T12", count: 2 },
      { hour: "2026-09-30T09", count: 2 },
    ]);
    assert.equal(s.nextAt, NOW.toISOString());
  });

  it("вердикт: выключено, cron молчит, дневной лимит, пауза", () => {
    const summary = summarizeQueue([{ waitReason: null, nextAttemptAt: null, emailQueued: true }], NOW);
    const base = {
      status: "sending",
      scheduledAt: null,
      pausedBy: null,
      summary,
      perDay: 10,
      sentToday: 10,
      windowStart: 0,
      windowEnd: 24,
      now: NOW,
    };
    const off = queueVerdict({ ...base, enabled: false, heartbeat: hours(-1) });
    assert.equal(off.stale, true);
    assert.deepEqual(
      off.issues.map((i) => i.level),
      ["error", "error", "warning"]
    );
    assert.match(off.issues[0].text, /выключена/);
    assert.match(off.issues[2].text, /ещё 0 из 1/);

    const fine = queueVerdict({ ...base, sentToday: 0, enabled: true, heartbeat: new Date(NOW.getTime() - 30_000) });
    assert.equal(fine.stale, false);
    assert.equal(fine.issues.length, 0);

    const paused = queueVerdict({ ...base, status: "paused", pausedBy: "root@wesetup.ru", enabled: true, heartbeat: NOW });
    assert.equal(paused.issues.length, 1);
    assert.match(paused.issues[0].text, /на паузе \(root@wesetup\.ru\)/);
  });
});
