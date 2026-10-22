import assert from "node:assert/strict";
import test from "node:test";
import { hygieneHealthPdfCopy, hygieneHealthPdfMonth, hygieneHealthPdfPosition, hygieneHealthPdfStatus, hygieneHealthPdfTitle, hygieneHealthPdfWeekday } from "./hygiene-health-pdf-presentation";

test("PDF calendar covers twelve months and seven weekdays without changing Russian conventions", () => {
  const months = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
  for (let month = 0; month < 12; month++) {
    const date = `2026-${String(month + 1).padStart(2, "0")}-01`;
    assert.equal(hygieneHealthPdfMonth(date, date, "uz"), `${months[month]}, 2026`);
    assert.equal(hygieneHealthPdfMonth(date, date, "en"), new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)));
  }
  const uz = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
  const ru = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  for (let day = 0; day < 7; day++) {
    const date = `2026-10-${11 + day}`;
    assert.equal(hygieneHealthPdfWeekday(date, "uz"), uz[day]);
    assert.equal(hygieneHealthPdfWeekday(date, "ru"), ru[day]);
  }
  for (const locale of ["ru", "en", "uz"] as const) assert.equal(hygieneHealthPdfMonth("2026-12-31", "2027-01-01", locale), "2026-12-31 — 2027-01-01");
  assert.throws(() => hygieneHealthPdfWeekday("invalid", "uz"), RangeError);
});

test("legacy hygiene and health PDF titles preserve explicit custom-identical text", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(hygieneHealthPdfTitle("Журнал здоровья", "health_check", locale), "Журнал здоровья");
    assert.equal(hygieneHealthPdfTitle("Гигиенический журнал (сотрудники)", "hygiene", locale), "Гигиенический журнал (сотрудники)");
    assert.equal(hygieneHealthPdfTitle("", "hygiene", locale), hygieneHealthPdfCopy(locale)("hygieneTitle"));
    assert.equal(hygieneHealthPdfTitle("", "health_check", locale), hygieneHealthPdfCopy(locale)("healthTitle"));
  }
});

test("PDF role fallback translates without translating explicit identical positions or unknown roles", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const user = { id: "u1", name: "Oʻtkir", role: "cook", positionTitle: "Повар" };
    assert.equal(hygieneHealthPdfPosition(user, "Повар", locale), "Повар");
    assert.equal(hygieneHealthPdfPosition({ ...user, positionTitle: null }, "Повар", locale), hygieneHealthPdfCopy(locale)("cook"));
    assert.equal(hygieneHealthPdfPosition({ ...user, role: "CUSTOM", positionTitle: null }, "custom", locale), "custom");
  }
});

test("PDF presentation preserves UTC month/range and original RU weekday semantics", () => {
  assert.equal(hygieneHealthPdfMonth("2026-04-01", "2026-04-14"), "Апрель 2026 г.");
  assert.equal(hygieneHealthPdfWeekday("2026-04-01"), "Ср");
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(hygieneHealthPdfMonth("2026-04-30", "2026-05-01", locale), "2026-04-30 — 2026-05-01");
    assert.equal(hygieneHealthPdfStatus(undefined, locale), "");
    assert.equal(hygieneHealthPdfStatus("sick_leave", locale), hygieneHealthPdfCopy(locale)("sickLeaveCode"));
  }
});
