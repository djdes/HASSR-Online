import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DRAFT_TTL_MS,
  describeDraftTime,
  getDraftTimeDescription,
  draftStorageKey,
  filledCount,
  hasMeaningfulValues,
  parseDraft,
  serializeDraft,
  stripTransientValues,
} from "@/lib/form-draft";

const now = new Date("2026-09-10T09:00:00.000Z");
const empty = { data: {}, areaId: "", equipmentId: "", catalogProductId: "" };

describe("draftStorageKey", () => {
  it("ключ — пользователь и журнал", () => {
    assert.equal(draftStorageKey("u1", "cooking_temp"), "wesetup.journal-draft.u1.cooking_temp");
  });
});

describe("hasMeaningfulValues / filledCount", () => {
  it("пустые строки, null, false и пустые массивы не считаются", () => {
    assert.equal(hasMeaningfulValues({ ...empty, data: { a: "", b: null, c: false, d: [], e: "  " } }), false);
    assert.equal(filledCount({ ...empty, data: { a: "x", b: 0, c: true, d: [1] }, areaId: "ar" }), 5);
  });
});

describe("stripTransientValues", () => {
  it("метки снимков без связи выбрасываются, загруженные адреса остаются", () => {
    const data = { photos: "https://x/1.jpg\nqueued-photo:abc", onlyQueued: "queued-photo:def", note: "ok" };
    assert.deepEqual(stripTransientValues(data), { photos: "https://x/1.jpg", note: "ok" });
  });
});

describe("serializeDraft / parseDraft", () => {
  it("круг: сохранили — прочитали", () => {
    const raw = serializeDraft({ ...empty, data: { temp: "4", note: "" }, equipmentId: "eq1" }, now);
    assert.ok(raw);
    const back = parseDraft(raw, new Date(now.getTime() + 60_000));
    assert.deepEqual(back?.data, { temp: "4", note: "" });
    assert.equal(back?.equipmentId, "eq1");
    assert.equal(back?.savedAt, now.toISOString());
  });
  it("нечего сохранять → null", () => {
    assert.equal(serializeDraft({ ...empty, data: { a: "" } }, now), null);
    assert.equal(serializeDraft({ ...empty, data: { photos: "queued-photo:1" } }, now), null);
  });
  it("устаревший, чужой версии, битый или из будущего — не восстанавливается", () => {
    const raw = serializeDraft({ ...empty, data: { a: "1" } }, now) as string;
    assert.equal(parseDraft(raw, new Date(now.getTime() + DRAFT_TTL_MS + 1)), null);
    assert.ok(parseDraft(raw, new Date(now.getTime() + DRAFT_TTL_MS - 1)));
    assert.equal(parseDraft(raw, new Date(now.getTime() - 5 * 60_000)), null);
    assert.equal(parseDraft(raw.replace('"v":1', '"v":2'), now), null);
    assert.equal(parseDraft("{not json", now), null);
    assert.equal(parseDraft(null, now), null);
    assert.equal(parseDraft(JSON.stringify({ v: 1, savedAt: now.toISOString(), data: [] }), now), null);
  });
});

describe("describeDraftTime", () => {
  const tz = "Europe/Moscow";
  it("сегодня / вчера / дата", () => {
    assert.equal(describeDraftTime("2026-09-10T06:03:00.000Z", now, tz), "сегодня в 09:03");
    assert.equal(describeDraftTime("2026-09-09T15:40:00.000Z", now, tz), "вчера в 18:40");
    assert.equal(describeDraftTime("2026-09-08T06:15:00.000Z", now, tz), "08.09 в 09:15");
    assert.equal(describeDraftTime("nope", now, tz), "недавно");
  });
});

describe("getDraftTimeDescription", () => {
  it("returns translated message keys and locale-formatted time values", () => {
    const instant = new Date("2026-09-10T06:03:00.000Z");
    const ru = getDraftTimeDescription(instant.toISOString(), now, "Europe/Moscow", "ru");
    const en = getDraftTimeDescription(instant.toISOString(), now, "Europe/Moscow", "en");
    const uz = getDraftTimeDescription(instant.toISOString(), now, "Europe/Moscow", "uz");
    assert.equal(ru.key, "todayAt");
    assert.equal(ru.time, "09:03");
    assert.equal(en.key, "todayAt");
    assert.match(en.time, /09:03/);
    assert.equal(uz.key, "todayAt");
    assert.match(uz.time, /09:03/);
    assert.deepEqual(getDraftTimeDescription("invalid", now, "Europe/Moscow", "en"), { key: "recently" });
  });

  it("compares local calendar days across DST transitions and formats older dates by locale", () => {
    const dstNow = new Date("2026-03-09T16:00:00.000Z");
    const yesterday = getDraftTimeDescription("2026-03-09T03:30:00.000Z", dstNow, "America/New_York", "en");
    assert.equal(yesterday.key, "yesterdayAt");
    const older = getDraftTimeDescription("2026-03-07T17:00:00.000Z", dstNow, "America/New_York", "uz");
    assert.equal(older.key, "dateAt");
    if (older.key === "dateAt") {
      assert.match(older.date, /07/);
      assert.match(older.time, /12:00/);
    }
  });
});
