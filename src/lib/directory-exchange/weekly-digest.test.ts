import assert from "node:assert/strict";
import test from "node:test";

import {
  EXCHANGE_DIGEST_HREF,
  EXCHANGE_DIGEST_MAX_ROWS,
  buildExchangeDigest,
  exchangeDigestEmail,
  exchangeDigestHasNews,
  exchangeDigestSubject,
  exchangeDigestTelegram,
  exchangeDigestTotals,
  exchangeDigestWeekKey,
  exchangeDigestWeekStart,
} from "./weekly-digest";

const members = [
  { organizationId: "a", name: "Кафе А", kinds: ["products", "staff"] },
  { organizationId: "b", name: "Бар <Б> & «Ко»", kinds: ["products"] },
  { organizationId: "c", name: "Столовая (закрыта)", kinds: ["products"] },
  { organizationId: "d", name: "Тихая точка", kinds: ["products"] },
];

test("неделя по Москве: ключ ISO-недели и понедельник 00:00", () => {
  assert.equal(exchangeDigestWeekKey(new Date("2026-11-21T12:00:00.000Z")), "2026-W47");
  // Понедельник 08:00 по Москве — уже следующая неделя.
  assert.equal(exchangeDigestWeekKey(new Date("2026-11-23T05:00:00.000Z")), "2026-W48");
  // Воскресенье 23:30 по Москве (20:30 UTC) — ещё прошлая неделя; через час — новая.
  assert.equal(exchangeDigestWeekKey(new Date("2026-11-22T20:30:00.000Z")), "2026-W47");
  assert.equal(exchangeDigestWeekKey(new Date("2026-11-22T21:30:00.000Z")), "2026-W48");
  // Год ISO-недели: 1 января 2027 — 53-я неделя 2026, 4 января 2027 — первая.
  assert.equal(exchangeDigestWeekKey(new Date("2027-01-01T09:00:00.000Z")), "2026-W53");
  assert.equal(exchangeDigestWeekKey(new Date("2027-01-04T09:00:00.000Z")), "2027-W01");
  assert.equal(exchangeDigestWeekKey(new Date("2026-01-01T09:00:00.000Z")), "2026-W01");
  assert.equal(exchangeDigestWeekStart(new Date("2026-11-21T12:00:00.000Z")).toISOString(), "2026-11-15T21:00:00.000Z");
  assert.equal(exchangeDigestWeekStart(new Date("2026-11-23T05:00:00.000Z")).toISOString(), "2026-11-22T21:00:00.000Z");
  // Понедельник 00:30 по Москве — уже новая неделя.
  assert.equal(exchangeDigestWeekStart(new Date("2026-11-22T21:30:00.000Z")).toISOString(), "2026-11-22T21:00:00.000Z");
});

test("строки: создано/изменено без отменённых, пропуски — только по спискам организации, закрытые не считаются", () => {
  const digest = buildExchangeDigest({
    weekKey: "2026-W48",
    members,
    locked: new Set(["c"]),
    changes: [
      { organizationId: "a", op: "create", undone: false, count: 3 },
      { organizationId: "a", op: "update", undone: false },
      { organizationId: "a", op: "create", undone: true, count: 10 },
      { organizationId: "b", op: "update", undone: false, count: 2 },
      { organizationId: "c", op: "create", undone: false, count: 5 },
      // Чужая организация (не участник своего аккаунта) — не попадает.
      { organizationId: "x", op: "create", undone: false, count: 7 },
      { organizationId: "a", op: "delete", undone: false, count: 4 },
    ],
    skips: [
      { organizationId: "a", entity: "product", count: 2 },
      { organizationId: "a", entity: "staff" },
      // «Б» больше не в списке «Сотрудники» — её пропуск сотрудника не ждёт разбора.
      { organizationId: "b", entity: "staff", count: 4 },
      { organizationId: "b", entity: "unknown" },
      { organizationId: "c", entity: "product", count: 1 },
    ],
    errorRuns: 0,
  });
  assert.deepEqual(digest.rows, [
    { organizationId: "a", name: "Кафе А", created: 3, updated: 1, pending: 3 },
    { organizationId: "b", name: "Бар <Б> & «Ко»", created: 0, updated: 2, pending: 0 },
  ]);
  assert.deepEqual(exchangeDigestTotals(digest), { created: 3, updated: 3, pending: 3 });
  assert.equal(exchangeDigestHasNews(digest), true);
  assert.equal(exchangeDigestSubject(digest), "Обмен справочниками за неделю: пришло 6, ждёт разбора 3");
});

test("пустая неделя — сообщать нечего; одни ошибки обмена — есть что", () => {
  const empty = buildExchangeDigest({ weekKey: "2026-W48", members, locked: new Set(), changes: [], skips: [], errorRuns: 0 });
  assert.deepEqual(empty.rows, []);
  assert.equal(exchangeDigestHasNews(empty), false);
  const onlyErrors = buildExchangeDigest({ weekKey: "2026-W48", members, locked: new Set(), changes: [], skips: [], errorRuns: 2 });
  assert.equal(exchangeDigestHasNews(onlyErrors), true);
  assert.equal(exchangeDigestSubject(onlyErrors), "Обмен справочниками за неделю: 2 обмена с ошибкой");
  assert.match(exchangeDigestTelegram(onlyErrors), /2 обмена с ошибкой за неделю/);
  assert.match(exchangeDigestEmail(onlyErrors, "https://wesetup.ru").html, /2 обмена с ошибкой/);
  assert.equal(exchangeDigestSubject({ ...onlyErrors, errorRuns: 5 }), "Обмен справочниками за неделю: 5 обменов с ошибкой");
  assert.equal(exchangeDigestSubject({ ...onlyErrors, errorRuns: 21 }), "Обмен справочниками за неделю: 21 обмен с ошибкой");
});

test("письмо и Telegram: таблица, ссылка на карточку, названия экранированы", () => {
  const digest = buildExchangeDigest({
    weekKey: "2026-W48",
    members,
    locked: new Set(),
    changes: [{ organizationId: "b", op: "create", undone: false, count: 1 }],
    skips: [{ organizationId: "a", entity: "product" }],
    errorRuns: 1,
  });
  const email = exchangeDigestEmail(digest, "https://wesetup.ru/");
  assert.equal(email.title, "Обмен справочниками за неделю");
  assert.equal(email.subject, "Обмен справочниками за неделю: пришло 1, ждёт разбора 1, 1 обмен с ошибкой");
  assert.match(email.html, /<th[^>]*>Организация<\/th><th[^>]*>Создано<\/th><th[^>]*>Изменено<\/th><th[^>]*>Ждёт разбора<\/th>/);
  assert.ok(email.html.includes("Бар &lt;Б&gt; &amp; «Ко»"));
  assert.ok(!email.html.includes("<Б>"));
  assert.ok(email.html.includes(`href="https://wesetup.ru${EXCHANGE_DIGEST_HREF}"`));
  // Индиго в письмах новой поры не используем.
  assert.ok(!/#5566f6/i.test(email.html));

  const telegram = exchangeDigestTelegram(digest);
  assert.ok(telegram.includes("• Кафе А: создано 0, изменено 0, ждёт разбора 1"));
  assert.ok(telegram.includes("• Бар &lt;Б&gt; &amp; «Ко»: создано 1, изменено 0"));
  assert.ok(!telegram.includes("<Б>"));
  assert.match(telegram, /1 обмен с ошибкой за неделю/);
});

test("много организаций: в письме и сообщении — первые строки и «и ещё N»", () => {
  const many = Array.from({ length: EXCHANGE_DIGEST_MAX_ROWS + 3 }, (_, index) => ({
    organizationId: `o${index}`,
    name: `Точка ${index}`,
    kinds: ["products"],
  }));
  const digest = buildExchangeDigest({
    weekKey: "2026-W48",
    members: many,
    locked: new Set(),
    changes: many.map((member) => ({ organizationId: member.organizationId, op: "create", undone: false })),
    skips: [],
    errorRuns: 0,
  });
  assert.equal(digest.rows.length, EXCHANGE_DIGEST_MAX_ROWS + 3);
  assert.match(exchangeDigestEmail(digest, "https://wesetup.ru").html, /И ещё 3/);
  assert.match(exchangeDigestTelegram(digest), /… и ещё 3/);
  assert.equal((exchangeDigestTelegram(digest).match(/^• Точка/gm) ?? []).length, EXCHANGE_DIGEST_MAX_ROWS);
});
