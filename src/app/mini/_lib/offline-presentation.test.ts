import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTranslator } from "next-intl";
import type { Messages } from "@/i18n/messages";
import { formatQueueError, formatQueueWhen } from "./offline-presentation";

const locales = ["ru", "en", "uz"] as const;
const catalogRoot = process.env.MINI_OFFLINE_CATALOG_ROOT ?? path.join(process.cwd(), "src/i18n/messages");

for (const locale of locales) {
  const messages = JSON.parse(readFileSync(path.join(catalogRoot, `${locale}.json`), "utf8")) as Messages;
  const t = createTranslator({ locale, messages, namespace: "miniOffline" });

  test(`offline diagnostics project exact historical values and conceal unknown details: ${locale}`, () => {
    assert.equal(formatQueueError("Фото потеряно — запишите заново со снимком", t), t("errors.missingPhoto"));
    assert.equal(formatQueueError("Сервер не принял фото", t), t("errors.rejectedPhoto"));
    assert.equal(formatQueueError("Сервер не принял запись (503)", t), t("errors.serverRejected", { status: "503" }));
    for (const unknown of ["Сервер не принял запись (503)\n", "Сервер не принял запись (503)\nPRIVATE", "Сервер не принял запись (5031)", "__proto__", "private database error"]) {
      assert.equal(formatQueueError(unknown, t), t("errors.generic"));
    }
  });

  test(`offline time uses local midnight and distinguishes previous calendar days: ${locale}`, () => {
    const today = new Date(2026, 9, 16, 0, 5).getTime();
    assert.equal(formatQueueWhen(today, locale, t, today + 1000), t("when.today", { time: "00:05" }));
    const yesterday = new Date(2026, 9, 15, 23, 59).getTime();
    const previous = formatQueueWhen(yesterday, locale, t, today);
    assert.ok(previous.includes("23:59"));
    assert.notEqual(previous, t("when.today", { time: "23:59" }));
    if (locale === "ru") assert.equal(previous, "15.10 в 23:59");
    const otherYear = formatQueueWhen(new Date(2025, 9, 16, 0, 5).getTime(), locale, t, today);
    assert.notEqual(otherYear, t("when.today", { time: "00:05" }));
  });

  test(`invalid persisted timestamps do not break the queue screen: ${locale}`, () => {
    for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      assert.equal(formatQueueWhen(invalid, locale, t), t("when.unknown"));
    }
    assert.notEqual(formatQueueWhen(0, locale, t), t("when.unknown"));
  });
}
