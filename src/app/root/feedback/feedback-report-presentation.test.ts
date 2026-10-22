import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliveredReplyCombination,
  feedbackReplyErrorKey,
  feedbackSourceKey,
  feedbackTypeKey,
  formatFeedbackReportDate,
  replyChannelCombination,
} from "./feedback-report-presentation";

test("type and source presentation preserves fallback behavior and guards prototype keys", () => {
  assert.equal(feedbackTypeKey("bug"), "page.type.bug");
  assert.equal(feedbackTypeKey("unknown"), "page.type.suggestion");
  assert.equal(feedbackTypeKey("constructor"), "page.type.suggestion");
  assert.equal(feedbackSourceKey("telegram"), "page.source.telegram");
  assert.equal(feedbackSourceKey("unknown"), "page.source.site");
  assert.equal(feedbackSourceKey("__proto__"), "page.source.site");
});

test("advertised and delivered channel matrices cover every combination", () => {
  const expected = ["none", "email", "telegram", "telegram_email", "app", "app_email", "app_telegram", "all"];
  const actual = [
    [false, false, false], [false, false, true], [false, true, false], [false, true, true],
    [true, false, false], [true, false, true], [true, true, false], [true, true, true],
  ];
  assert.deepEqual(actual.map(([app, telegram, email]) => replyChannelCombination(app, telegram, email)), expected);
  assert.equal(deliveredReplyCombination(false, false, false), null);
  assert.equal(deliveredReplyCombination(true, false, true), "app_email");
});

test("known server errors map safely while unknown diagnostics are hidden", () => {
  assert.equal(feedbackReplyErrorKey("Введите текст ответа"), "required");
  assert.equal(feedbackReplyErrorKey("Некорректные данные"), "invalid");
  assert.equal(feedbackReplyErrorKey("Обращение не найдено"), "notFound");
  assert.equal(feedbackReplyErrorKey("internal trace with customer details"), "failed");
  assert.equal(feedbackReplyErrorKey(new Error("secret")), "failed");
});

test("Moscow report datetime preserves native RU and uses stable whole second UZ values", () => {
  const date = new Date("2026-10-16T00:30:01.000Z");
  assert.equal(formatFeedbackReportDate(date, "ru"), date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }));
  assert.equal(formatFeedbackReportDate(date, "en"), date.toLocaleString("en-GB", { timeZone: "Europe/Moscow" }));
  const moscowOptions: Intl.DateTimeFormatOptions = { timeZone: "Europe/Moscow" };
  assert.equal(formatFeedbackReportDate(date, "uz"), date.toLocaleString("en-GB", moscowOptions));
  assert.equal(formatFeedbackReportDate(new Date(NaN), "ru"), "Invalid Date");
  assert.equal(formatFeedbackReportDate(new Date(NaN), "en"), "Invalid Date");
  assert.equal(formatFeedbackReportDate(new Date(NaN), "uz"), "Invalid Date");
});

test("Moscow civil timestamps are host-zone independent across year boundaries and pre-1970 dates", () => {
  const priorZone = process.env.TZ;
  const cases = ["2026-01-01T00:00:00.000Z", "1969-12-31T20:00:00.000Z"] as const;
  const moscowOptions: Intl.DateTimeFormatOptions = { timeZone: "Europe/Moscow" };
  try {
    for (const zone of ["Europe/Moscow", "Pacific/Honolulu", "Asia/Tashkent", "Europe/London"]) {
      process.env.TZ = zone;
      for (const iso of cases) {
        const date = new Date(iso);
        const expectedUz = date.toLocaleString("en-GB", moscowOptions);
        assert.equal(formatFeedbackReportDate(date, "uz"), expectedUz, `${zone} ${iso}`);
        assert.equal(formatFeedbackReportDate(date, "ru"), date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }));
        assert.equal(formatFeedbackReportDate(date, "en"), date.toLocaleString("en-GB", { timeZone: "Europe/Moscow" }));
      }
    }
  } finally {
    if (priorZone === undefined) delete process.env.TZ;
    else process.env.TZ = priorZone;
  }
});
