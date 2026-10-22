import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "next-intl";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { SUBSCRIPTION_MAX_USERS } from "@/lib/plan-catalog";
import { billingExplanation, billingPhaseLabel } from "./tariff-presentation";

test("billing phases preserve exact start/end boundaries in all locales", () => {
  const settings = { startsAt: "2026-10-01T21:00:00Z", endsAt: "2026-10-31T21:00:00Z", graceDays: 3, transitionEnabled: true };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = { ru, en, uz }[locale];
    const t = createTranslator({ locale, messages, namespace: "rootTariffs" });
    const start = new Date(settings.startsAt).getTime(), end = new Date(settings.endsAt).getTime();
    assert.equal(billingPhaseLabel(t, settings, start - 1), t("phaseBefore"));
    for (const instant of [start, end - 1]) assert.equal(billingPhaseLabel(t, settings, instant), t("phaseDuring", { count: SUBSCRIPTION_MAX_USERS }));
    assert.equal(billingPhaseLabel(t, settings, end), t("phaseAfterEnabled"));
    assert.equal(billingPhaseLabel(t, { ...settings, transitionEnabled: false }, end), t("phaseAfterDisabled"));
    assert.equal(billingExplanation(t), t("explanation", { subscriptionCount: SUBSCRIPTION_MAX_USERS, freeCount: FREE_MAX_USERS }));
    assert.deepEqual(settings, { startsAt: "2026-10-01T21:00:00Z", endsAt: "2026-10-31T21:00:00Z", graceDays: 3, transitionEnabled: true });
  }
});

test("Russian ordinary phase copy and seat plurals remain faithful", () => {
  const t = createTranslator({ locale: "ru", messages: ru, namespace: "rootTariffs" });
  assert.equal(t("phaseDuring", { count: 10 }), "Идёт бесплатный период — у всех подписка до 10 сотрудников");
  for (const [count, suffix] of [[1, "сотрудника"], [2, "сотрудников"], [5, "сотрудников"], [21, "сотрудника"]] as const) {
    assert.equal(t("phaseDuring", { count }), `Идёт бесплатный период — у всех подписка до ${count} ${suffix}`);
  }
});

test("whole secondary/forecast messages preserve zero counts and optional branch order", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = { ru, en, uz }[locale];
    const t = createTranslator({ locale, messages, namespace: "rootTariffs" });
    for (const mode of ["free", "legacy", "both"]) assert.ok(t("secondary", { mode, freePeriod: 7, legacy: 8 }).endsWith("."));
    assert.ok(t("forecast", { paid: 0, free: 2, waiting: 3 }).includes("0"));
    assert.ok(t("tariffSaved", { title: "Подписка {custom}" }).includes("Подписка {custom}"));
  }
});
