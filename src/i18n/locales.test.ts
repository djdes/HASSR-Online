import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, formatNumber, isLocale, resolveLocale } from "./locales";
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
