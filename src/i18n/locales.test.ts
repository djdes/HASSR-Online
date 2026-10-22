import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMAT_LOCALES, formatDate, formatNumber, isLocale, resolveLocale } from "./locales";
import { translatorFor } from "./translator";
import { evaluatePartnerRequest } from "../lib/partners/access-guard";
import { evaluateDirectoryRequest } from "../lib/master-directory-access";

test("language resolution preserves personal choices across tenant switches and ignores guest cookies for staff", () => {
  assert.equal(resolveLocale({ publicLocale: "ru", authenticated: true, userLocale: "uz" }), "ru");
  assert.equal(resolveLocale({ authenticated: true, userLocale: "uz", organizationLocale: "en", cookieLocale: "ru" }), "uz");
  assert.equal(resolveLocale({ authenticated: true, userLocale: null, organizationLocale: "en", cookieLocale: "uz" }), "en");
  assert.equal(resolveLocale({ cookieLocale: "uz", organizationLocale: "en" }), "uz");
  assert.equal(resolveLocale({ organizationLocale: "en" }), "en");
  assert.equal(resolveLocale({ userLocale: "EN", cookieLocale: "__proto__", organizationLocale: "kk" }), "ru");
  for (const invalid of [null, undefined, {}, "en-US", "UZ", "", "__proto__"]) assert.equal(isLocale(invalid), false);
});

test("formatting never changes the requested business timezone or monetary amount", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.match(formatDate(locale, new Date("2026-10-13T21:30:00Z"), "Europe/Moscow", { day: "numeric" }), /14/);
    assert.match(formatNumber(locale, 123, { style: "currency", currency: "RUB" }), /123/);
  }
});

test("concurrent jobs keep independent locales and interpolate complete sentences", async () => {
  const [ru, en, uz] = await Promise.all([translatorFor("ru"), translatorFor("en"), translatorFor("uz")]);
  assert.equal(ru("journals.entryCount", { count: 21 }), "21 запись");
  assert.equal(ru("journals.entryCount", { count: 5 }), "5 записей");
  assert.equal(en("journals.entryCount", { count: 2 }), "2 entries");
  assert.equal(uz("journals.progress", { filled: 2, total: 5 }), "5 tadan 2 tasi to‘ldirilgan");
  assert.equal(ru("common.save"), "Сохранить");
});

test("read-only partners and directory users can change their own language, not organization settings", () => {
  const claim = { partnerId: "p", organizationId: "client", level: "view" as const };
  assert.deepEqual(evaluatePartnerRequest({ method: "PATCH", pathname: "/api/profile/locale", claim }), { allow: true });
  assert.equal(evaluatePartnerRequest({ method: "PATCH", pathname: "/api/profile/complete", claim }).allow, false);
  assert.deepEqual(evaluateDirectoryRequest("/api/profile/locale", "directory"), { action: "allow" });
  assert.equal(evaluateDirectoryRequest("/api/settings/organization", "directory").action, "deny");
});


test("finite Uzbek decimal separators remain stable for SSR and browser presentation", () => {
  const cases: Array<[number, string]> = [
    [0, "0"], [-0, "-0"], [0.5, "0,5"], [-0.5, "-0,5"],
    [1.23456, "1,235"], [-1.23456, "-1,235"], [12.0004, "12"], [12.0005, "12,001"],
    [12500, "12\u00a0500"], [-12500, "-12\u00a0500"],
    [1000000.1234, "1\u00a0000\u00a0000,123"], [999999.9999, "1\u00a0000\u00a0000"],
    [Number.MAX_SAFE_INTEGER, "9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0991"],
    [1e-7, "0"], [-1e-7, "-0"],
  ];
  for (const [value, expected] of cases) {
    assert.equal(formatNumber("uz", value), expected);
    for (const locale of ["ru", "en"] as const) {
      assert.equal(formatNumber(locale, value), new Intl.NumberFormat(FORMAT_LOCALES[locale]).format(value));
    }
  }
  assert.equal(formatNumber("uz", 0.5, { useGrouping: false, maximumFractionDigits: 1 }), "0,5");
});

test("Uzbek separator presentation preserves original words, options and nonfinite values", () => {
  const profiles: Intl.NumberFormatOptions[] = [
    { style: "currency", currency: "RUB", currencyDisplay: "name" },
    { style: "unit", unit: "meter", unitDisplay: "long" },
    { style: "percent", maximumFractionDigits: 2 },
    { notation: "scientific", maximumFractionDigits: 2 },
    { notation: "compact", compactDisplay: "long" },
  ];
  for (const options of profiles) {
    const beforeOptions = JSON.stringify(options);
    for (const value of [0.5, -12500.25]) {
      const native = new Intl.NumberFormat(FORMAT_LOCALES.uz, options);
      const actual = formatNumber("uz", value, options);
      for (const part of native.formatToParts(value)) {
        if (!["decimal", "group"].includes(part.type)) assert.ok(actual.includes(part.value));
      }
      for (const locale of ["ru", "en"] as const) {
        assert.equal(formatNumber(locale, value, options), new Intl.NumberFormat(FORMAT_LOCALES[locale], options).format(value));
      }
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const locale of ["ru", "en", "uz"] as const) {
        assert.equal(formatNumber(locale, value, options), new Intl.NumberFormat(FORMAT_LOCALES[locale], options).format(value));
      }
    }
    assert.equal(JSON.stringify(options), beforeOptions);
  }
});
