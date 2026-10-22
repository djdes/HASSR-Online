import assert from "node:assert/strict";
import test from "node:test";
import { FORMAT_LOCALES, formatNumber } from "@/i18n/locales";
import {
  formatServiceRequestAmount,
  formatServiceRequestTimestamp,
  serviceRequestDeliveryKey,
  serviceRequestErrorKey,
  serviceRequestStatusKey,
} from "./service-request-presentation";

test("known statuses use stable own keys and unknown/prototype-like values stay literal", () => {
  assert.equal(serviceRequestStatusKey("new"), "status.new");
  assert.equal(serviceRequestStatusKey("in_progress"), "status.inProgress");
  assert.equal(serviceRequestStatusKey("toString"), undefined);
  assert.equal(serviceRequestStatusKey("constructor"), undefined);
  assert.equal(serviceRequestStatusKey("__proto__"), undefined);
  assert.equal(serviceRequestStatusKey("customer status"), undefined);
});

test("delivery booleans map to all four stable complete-sentence cases", () => {
  assert.equal(serviceRequestDeliveryKey(true, true), "both");
  assert.equal(serviceRequestDeliveryKey(true, false), "telegram");
  assert.equal(serviceRequestDeliveryKey(false, true), "email");
  assert.equal(serviceRequestDeliveryKey(false, false), "none");
});

test("API adapter translates only exact known legacy messages", () => {
  assert.equal(serviceRequestErrorKey("Заявка не найдена"), "errors.notFound");
  assert.equal(serviceRequestErrorKey("Некорректный запрос"), "errors.invalidRequest");
  assert.equal(serviceRequestErrorKey("Новая"), "errors.updateFailed");
  assert.equal(serviceRequestErrorKey({ error: "Заявка не найдена" }), "errors.updateFailed");
  assert.equal(serviceRequestErrorKey("toString"), "errors.updateFailed");
});

test("Russian keeps the original native host-local timestamp; EN/UZ return parts without changing the instant", () => {
  const value = "2026-10-16T08:07:06.000Z";
  const date = new Date(value);
  const expectedRu = date.toLocaleString("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  assert.deepEqual(formatServiceRequestTimestamp(value, "ru"), { kind: "native", value: expectedRu });
  for (const locale of ["en", "uz"] as const) {
    const parts = formatServiceRequestTimestamp(value, locale);
    assert.equal(parts.kind, "localized");
    if (parts.kind === "localized") {
      assert.match(parts.date, /2026/);
      assert.match(parts.time, /\d/);
    }
  }
});

test("invalid timestamp retains nonthrowing native behavior in every locale", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const rendered = formatServiceRequestTimestamp("not-a-date", locale);
    assert.equal(rendered.kind, "native");
    assert.match(rendered.value, /Invalid Date/);
  }
});

test("finite paid amounts retain native RU/EN and healthy Uzbek default decimals", () => {
  const values = [0, -0, 1, -1, 4000, 9000, 12500, 1000000, 0.1256, -0.1256, 12500.5, -4000.1256];
  for (const value of values) {
    for (const locale of ["ru", "en", "uz"] as const) {
      assert.equal(formatServiceRequestAmount(value, locale), new Intl.NumberFormat(FORMAT_LOCALES[locale]).format(value));
    }
  }
  assert.equal(formatServiceRequestAmount(12500.5, "uz"), "12\u00a0500,5");
});

test("nonfinite paid amounts use the unchanged original locale formatter path", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const locale of ["ru", "en", "uz"] as const) {
      assert.equal(formatServiceRequestAmount(value, locale), formatNumber(locale, value));
    }
  }
});
