import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "next-intl";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { FREE_MAX_JOURNALS } from "@/lib/tariff-plans";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { trialExplanation, trialPhaseLabel } from "./tariff-presentation";

const settings = { trialDays: 14, launchedAt: "2026-10-25T21:00:00Z", graceDays: 7, transitionEnabled: true };

test("trial phases switch exactly at the launch moment in all locales", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = { ru, en, uz }[locale];
    const t = createTranslator({ locale, messages, namespace: "rootTariffs" });
    const launch = new Date(settings.launchedAt).getTime();
    assert.equal(trialPhaseLabel(t, settings, launch - 1), t("phaseBeforeLaunch", { date: "26.10.2026, 00:00" }));
    assert.equal(trialPhaseLabel(t, settings, launch), t("phaseActive", { trialDays: 14 }));
    assert.equal(trialPhaseLabel(t, { ...settings, transitionEnabled: false }, launch), t("phaseTransitionOff", { trialDays: 14 }));
    assert.equal(
      trialExplanation(t, settings),
      t("trialExplanation", { trialDays: 14, freeEmployees: FREE_MAX_USERS, freeJournals: FREE_MAX_JOURNALS })
    );
    assert.deepEqual(settings, { trialDays: 14, launchedAt: "2026-10-25T21:00:00Z", graceDays: 7, transitionEnabled: true });
  }
});

test("Russian trial copy names the free limits and the launch date in Moscow time", () => {
  const t = createTranslator({ locale: "ru", messages: ru, namespace: "rootTariffs" });
  assert.equal(trialPhaseLabel(t, settings, Date.parse("2026-10-01T00:00:00Z")), "Тарифы запустятся 26.10.2026, 00:00 (МСК) — до этого всё как раньше");
  assert.match(trialExplanation(t, settings), /14 дней/);
  assert.match(trialExplanation(t, settings), /1 сотрудник и 1 журнал/);
});

test("price editor and counters messages keep their arguments", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = { ru, en, uz }[locale];
    const t = createTranslator({ locale, messages, namespace: "rootTariffs" });
    assert.ok(t("paidHint", { standard: 0, premium: 2, legacy: 3 }).includes("2"));
    assert.ok(t("trialHint", { count: 4 }).includes("4"));
    assert.ok(t("tariffSaved", { title: "Стандарт {custom}" }).includes("Стандарт {custom}"));
    assert.ok(t("yearTotal", { amount: "23 880 ₽" }).includes("23 880 ₽"));
  }
});
