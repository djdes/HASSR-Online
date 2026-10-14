import assert from "node:assert/strict";
import { test } from "node:test";
import { publicCopyFor, publicError } from "./public-copy";
import { PUBLIC_EN } from "./public-en";
import { CHAPTERS, DEMO, FRYER_FIELDS, JOURNALS, PDF, UI } from "@/components/landing/qr-player/chapters";
import { HEALTH_CONFIRMATIONS } from "@/lib/health-qr";
import { HYGIENE_V2_COLUMNS, HYGIENE_V2_FORM_CAPTION } from "@/lib/hygiene-v2";
import { HARDWARE_BUNDLES, HARDWARE_DEVICES } from "@/lib/hardware-pricing";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { ORG_SPHERES } from "@/lib/org-profile";
import { promotionBadgeLabel, promotionEndHint } from "@/lib/promo/promotions";

test("Russian copy is unchanged, English copy preserves surrounding spacing", () => {
  const source = "  Войти ";
  assert.equal(publicCopyFor("ru")(source), source);
  assert.equal(publicCopyFor("en")(source), "  Sign in ");
  assert.equal(publicCopyFor("en")("unknown user text"), "unknown user text");
  for (const [key, value] of Object.entries(PUBLIC_EN)) {
    assert.equal(key, key.trim());
    assert.ok(value.trim(), key);
    assert.doesNotMatch(value, /[А-Яа-яЁё]/, key);
  }
});

test("all controlled QR demo and equipment product text has English copy", () => {
  const tr = publicCopyFor("en");
  function check(value: unknown): void {
    if (typeof value === "string" && /[А-Яа-яЁё]/.test(value)) {
      assert.doesNotMatch(tr(value), /[А-Яа-яЁё]/, value);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) check(child);
    }
  }
  for (const value of [CHAPTERS, DEMO, FRYER_FIELDS, JOURNALS, PDF, UI, HEALTH_CONFIRMATIONS, HYGIENE_V2_COLUMNS, HYGIENE_V2_FORM_CAPTION, HARDWARE_DEVICES, HARDWARE_BUNDLES, ACTIVE_JOURNAL_CATALOG, ORG_SPHERES]) check(value);
});

test("known API failures retain their meaning; unknown failures use localized copy", () => {
  assert.match(publicError("en", "Слишком часто. Попробуйте через несколько минут", "Ошибка"), /few minutes/);
  assert.equal(publicError("en", "Unknown server detail", "Ошибка"), "Error");
  assert.equal(publicError("ru", "Сбой", "Ошибка"), "Сбой");
});

test("English promotion deadline preserves the Moscow midnight boundary", () => {
  const promotion = { percent: 20, endsAt: "2026-10-10T21:00:00.000Z" };
  assert.equal(promotionBadgeLabel(promotion, "en"), "−20\u00a0% until 10\u00a0October");
  assert.equal(promotionEndHint(promotion, "en"), "Promotion ends on 10.10.2026, 23:59 Moscow time");
  assert.match(promotionBadgeLabel(promotion), /до 10/);
});
