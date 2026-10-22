import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { ORG_SPHERES } from "@/lib/org-profile";
import { defaultKpPayload, kpDiscountLabel, type KpPromoOption } from "@/lib/mailing/kinds/kp-shared";
import { coerceMessagePayload } from "@/lib/mailing/kinds/message-shared";
import { MAILING_VARIABLES, substituteVariables } from "@/lib/mailing/text-format";
import { describeDiscount } from "@/lib/promo/rules";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { promoEndsAfterDays } from "@/lib/promo/valid-days";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { fieldDiscountLabel, fieldNumber, fieldPromoOptionLabel, fieldSphereKey, fieldSphereLabel } from "./kind-fields-presentation";

const catalogs = { ru, en, uz };
const locales: Locale[] = ["ru", "en", "uz"];
const option: KpPromoOption = { code: "RAW_КОД-21", kind: "fixed", value: 12500, lifetime: false, endsAt: "2026-12-31T21:00:00Z", usesLeft: 12500, newClientsOnly: false, label: "NEVER parse this raw Russian producer label" };

test("sphere map covers original order and excludes prototype and unknown values", () => {
  assert.equal(ORG_SPHERES.length, 16);
  for (const sphere of ORG_SPHERES) assert.equal(fieldSphereKey(sphere.value), `spheres.${sphere.value}`);
  for (const raw of ["toString", "constructor", "__proto__", "RAW-новая", "", "Restaurant"]) {
    assert.equal(fieldSphereKey(raw), null);
    assert.equal(fieldSphereLabel(raw, "RAW Русская метка", () => assert.fail("unknown/prototype sphere translated")), "RAW Русская метка");
  }
  assert.equal(fieldSphereLabel("restaurant", "RAW label", key => "translated:" + key), "translated:spheres.restaurant");
});

test("RU option display exactly matches structured producer semantics across branches", () => {
  const t = createTranslator({ locale: "ru", messages: ru, namespace: "rootMailingKindFields" });
  for (const kind of ["percent", "fixed"] as const) for (const lifetime of [false, true]) for (const endsAt of [null, option.endsAt]) for (const usesLeft of [null, 0, 1, 2, 5, 21, 12500]) for (const newClientsOnly of [false, true]) {
    const input = { ...option, kind, lifetime, endsAt, usesLeft, newClientsOnly };
    const parts = [`${input.code} · ${describeDiscount(input)}`];
    if (lifetime) parts[0] += " навсегда";
    else if (endsAt) parts[0] += ` ${promotionEndLabel(endsAt)}`;
    if (usesLeft !== null) parts.push(`ещё ${usesLeft} опл.`);
    if (newClientsOnly) parts.push("только новым");
    assert.equal(fieldPromoOptionLabel(input, "ru", args => t("kp.option", args)), parts.join(" · "));
  }
});

test("translated structured labels retain raw identifiers/counts and leave inputs untouched", () => {
  for (const locale of locales) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootMailingKindFields" });
    for (const count of [0, 1, 2, 5, 21, 12500]) {
      const input = { ...option, usesLeft: count, newClientsOnly: true };
      const before = JSON.stringify(input);
      const result = fieldPromoOptionLabel(input, locale, args => t("kp.option", args));
      assert.ok(result.startsWith(input.code + " · "));
      assert.ok(result.includes(String(count)));
      assert.ok(!result.includes("NEVER"));
      assert.equal(JSON.stringify(input), before);
    }
    assert.equal(fieldNumber(12500, locale), (12500).toLocaleString({ ru: "ru-RU", en: "en-GB", uz: "ru-RU" }[locale]));
    const unknown = { ...option, kind: "extension" } as unknown as KpPromoOption;
    assert.equal(fieldPromoOptionLabel(unknown, locale, () => assert.fail("unknown kind translated")), option.label);
  }
});

test("private discount preserves percent, currency, minus and separate option spaces", () => {
  for (const value of [0, 1, 2, 5, 21, 12500]) for (const kind of ["percent", "fixed"] as const) {
    assert.equal(fieldDiscountLabel(kind, value, "ru"), kpDiscountLabel(kind, value));
    assert.equal(fieldDiscountLabel(kind, value, "ru", true), describeDiscount({ kind, value }));
    for (const locale of locales) assert.ok(fieldDiscountLabel(kind, value, locale).endsWith(kind === "percent" ? "\u00a0%" : "\u00a0₽"));
  }
});

test("Moscow exclusive midnight, inclusive 23:59 and arbitrary time retain original date semantics", () => {
  for (const locale of locales) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootMailingKindFields" });
    for (const endsAt of ["2026-01-01T21:00:00Z", "2026-01-01T20:59:00Z", "2026-01-01T09:35:00Z"]) {
      assert.equal(fieldPromoOptionLabel({ ...option, endsAt, usesLeft: null }, locale, args => t("kp.option", args)), `${option.code} · ${fieldDiscountLabel("fixed", option.value, locale, true)} ${promotionEndLabel(endsAt, locale)}`);
    }
    assert.equal(promotionEndLabel("2026-01-01T21:00:00Z", locale), promotionEndLabel("2026-01-01T20:59:00Z", locale));
    const date = promoEndsAfterDays(new Date("2026-10-18T21:00:00Z"), 1);
    assert.equal(date.toISOString(), "2026-10-20T20:59:59.999Z");
  }
});

test("author examples preserve raw parser grammar and defaults remain outbound bytes", () => {
  for (const locale of locales) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootMailingKindFields" });
    assert.ok(t("message.subjectExample", { nameToken: "{имя}" }).includes("{имя}"));
    const body = t("message.bodyExample", { nameToken: "{имя}", companyToken: "{компания}" });
    assert.ok(body.includes("{имя}")); assert.ok(body.includes("{компания}"));
    const payload = coerceMessagePayload({});
    assert.deepEqual(payload.fallbacks, { name: "коллеги", company: "ваше заведение", sphere: "общепит" });
    assert.deepEqual(MAILING_VARIABLES.map(v => v.token), ["имя", "компания", "сфера"]);
    assert.equal(substituteVariables("{имя|друзья}/{компания}/{сфера}", {}), "друзья/ваше заведение/общепит");
    assert.equal(defaultKpPayload().promo.validDays, 14);
  }
});


test("finite Uzbek decimal presentation has an explicit stable profile without rewriting values", () => {
  const cases: Array<[number, string]> = [
    [0, "0"], [-0, "-0"], [0.5, "0,5"], [-0.5, "-0,5"],
    [1.23456, "1,235"], [-1.23456, "-1,235"], [12.0004, "12"], [12.0005, "12,001"],
    [-12.0005, "-12,001"], [0.0004, "0"], [-0.0004, "-0"], [0.0005, "0,001"],
    [12500, "12\u00a0500"], [-12500, "-12\u00a0500"], [1000000.1234, "1\u00a0000\u00a0000,123"],
    [999999.9999, "1\u00a0000\u00a0000"], [Number.MAX_SAFE_INTEGER, "9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0991"],
    [-Number.MAX_SAFE_INTEGER, "-9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0991"],
    [1e21, "1\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000"], [1e-7, "0"], [-1e-7, "-0"],
  ];
  for (const [value, expected] of cases) {
    assert.equal(fieldNumber(value, "uz"), expected);
    assert.equal(fieldNumber(value, "ru"), value.toLocaleString("ru-RU"));
    assert.equal(fieldNumber(value, "en"), value.toLocaleString("en-GB"));
    assert.equal(fieldDiscountLabel("fixed", value, "uz"), `−${expected}\u00a0₽`);
    assert.equal(fieldDiscountLabel("fixed", value, "uz", true), `−${expected} ₽`);
    assert.equal(fieldDiscountLabel("percent", value, "uz"), `−${String(value)}\u00a0%`);
  }
});

test("nonfinite values keep each original native locale path", () => {
  for (const value of [NaN, Infinity, -Infinity]) for (const locale of locales) {
    assert.equal(fieldNumber(value, locale), value.toLocaleString({ ru: "ru-RU", en: "en-GB", uz: "uz-Latn-UZ" }[locale]));
  }
});
