import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeFunnelDigest, funnelDigestKey, leadingChannel, previousWeekRange } from "@/lib/funnel-digest";
import type { FunnelOrg } from "@/lib/signup-funnel";

const org = (patch: Partial<FunnelOrg>): FunnelOrg => ({
  createdAt: new Date("2026-10-28T10:00:00Z"),
  channel: "direct",
  profileDone: false,
  hasEntry: false,
  activeUsers: 1,
  paid: false,
  ...patch,
});

describe("сводка воронки по понедельникам", () => {
  it("прошлая неделя — с понедельника по Москве", () => {
    // Пн 02.11 08:00 МСК.
    const range = previousWeekRange(new Date("2026-11-02T05:00:00Z"));
    assert.equal(range.start.toISOString(), "2026-10-25T21:00:00.000Z");
    assert.equal(range.end.toISOString(), "2026-11-01T21:00:00.000Z");
    assert.equal(range.weekStart, "2026-10-26");
    assert.equal(funnelDigestKey(range.weekStart), "funnel-weekly:2026-10-26");
  });

  it("лучший канал: «нет данных» не побеждает, ничья — по порядку каналов", () => {
    const cohort = [org({ channel: "unknown" }), org({ channel: "unknown" }), org({ channel: "search_yandex" }), org({ channel: "yandex_direct", paid: true })];
    assert.deepEqual(leadingChannel(cohort), { channel: "yandex_direct", count: 1 });
    assert.deepEqual(leadingChannel(cohort, (item) => item.paid), { channel: "yandex_direct", count: 1 });
    assert.equal(leadingChannel([]), null);
  });

  it("текст: регистрации и сравнение, шаги когорты, оплаты, показы, каналы, ссылка", () => {
    const text = (composeFunnelDigest(
      {
        weekStart: "2026-10-26",
        cohort: [
          org({ channel: "yandex_direct", profileDone: true, hasEntry: true, activeUsers: 2, paid: true }),
          org({ channel: "yandex_direct", profileDone: true }),
          org({ channel: "search_yandex" }),
        ],
        previousRegistrations: 5,
        payments: { count: 2, amountRub: 26880 },
        demo: { requests: 3, booked: 2 },
      },
      "https://wesetup.ru",
    )).replace(/[\u00a0\u202f]/g, " ");
    assert.equal(
      text,
      [
        "<b>📊 Воронка за неделю 26.10 – 01.11</b>",
        "Регистраций: <b>3</b> (неделей раньше 5, −2)",
        "Из них дошли: анкета 2 · первая запись 1 · команда 1 · оплата 1",
        "Оплат за неделю: <b>2</b> на 26 880 ₽",
        "Заявок на показ: 3 (записались на время — 2)",
        "Больше всего регистраций: Яндекс Директ — 2",
        "Оплатили из канала: Яндекс Директ — 1",
        "Подробно: https://wesetup.ru/root/funnel",
      ].join("\n"),
    );
    const quiet = composeFunnelDigest(
      { weekStart: "2026-10-26", cohort: [], previousRegistrations: 0, payments: { count: 0, amountRub: 0 }, demo: { requests: 0, booked: 0 } },
      "https://wesetup.ru",
    );
    assert.match(quiet, /Регистраций: <b>0<\/b> \(неделей раньше 0, столько же\)/);
    assert.doesNotMatch(quiet, /Из них дошли|Больше всего/);
  });
});
