import test from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "next-intl";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { describePromotionChange, validatePromotionInput } from "@/lib/promo/promotions";
import { inferPromotionAuditPresentation } from "@/lib/promo/promotion-audit-presentation";
import { formatPriceRub } from "@/components/pricing/promo-price";
import { formatPromotionAmount, promotionActionLabel, promotionError, promotionHistorySummary } from "./promotion-presentation";

test("real producer history, raw fallback and validator messages across three locales", () => {
  const before = { title: "заметка изменена; → custom", percent: 20, startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-01T00:00:00.000Z"), active: true, note: null };
  const after = { ...before, title: "Без изменений raw", percent: 25, active: false, note: "PRIVATE" };
  const summary = describePromotionChange(before, after), snapshot = (v: typeof before) => ({ ...v, startsAt: v.startsAt.toISOString(), endsAt: v.endsAt.toISOString() });
  const row = { id: "1", action: "promotion.update", title: after.title, summary, at: before.startsAt.toISOString(), userName: "Автор", promotionId: "1", presentation: inferPromotionAuditPresentation("promotion.update", { title: after.title, summary, before: snapshot(before), after: { ...snapshot(before), ...after, startsAt: after.startsAt.toISOString(), endsAt: after.endsAt.toISOString() } }) };
  for (const locale of ["ru","en","uz"] as const) {
    const t = createTranslator({ locale, messages: {ru,en,uz}[locale], namespace: "rootPromotions" });
    const rendered = promotionHistorySummary(row, t)!; assert.ok(rendered.includes(before.title)); assert.ok(rendered.includes(after.title)); assert.ok(rendered.includes(t("historyNote"))); assert.ok(!rendered.includes("PRIVATE"));
    if (locale === "ru") assert.equal(rendered, summary);
    assert.equal(promotionHistorySummary({ ...row, presentation: { version: 9 }, summary: "CUSTOM сохранена" }, t), "CUSTOM сохранена");
    assert.equal(promotionActionLabel("constructor", t), "constructor"); assert.equal(promotionActionLabel("__proto__", t), "__proto__"); assert.equal(promotionActionLabel("promotion.create", t), t("actionCreate"));
    for (const value of [{ ...before, title: "" }, { ...before, title: "x".repeat(121) }, { ...before, percent: 91 }, { ...before, startsAt: new Date(NaN) }, { ...before, endsAt: before.startsAt }, { ...before, note: "x".repeat(501) }]) {
      const result = validatePromotionInput(value); assert.equal(result.ok, false);
      if (!result.ok) { const text = promotionError(result.error, t); assert.notEqual(text, t("saveFailed"), result.error); if (locale === "ru") assert.equal(text, result.error); }
    }
    assert.equal(promotionError("PRIVATE HTTP", t, "deleteFailed"), t("deleteFailed"));
    for (const value of [0,1,1000,4000,9000,12500,12500.25,-12500.25,NaN,Infinity,-Infinity]) assert.equal(formatPromotionAmount(value, locale), formatPriceRub(value, locale === "uz" && Number.isFinite(value) ? "ru" : locale));
  }
});
