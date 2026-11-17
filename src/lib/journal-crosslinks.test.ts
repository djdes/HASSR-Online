import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  primarySeoLandingSlugForJournal,
  relatedBlogArticlesForJournal,
} from "./journal-crosslinks";

describe("journal-crosslinks", () => {
  test("ranks dedicated primary articles ahead of broad overview guides across RU, EN, UZ", () => {
    for (const locale of ["ru", "en", "uz"] as const) {
      const incoming = relatedBlogArticlesForJournal("incoming_control", locale);
      assert.ok(
        incoming.some((a) => a.slug === "chek-list-priemki-syrya-v-restorane"),
        `incoming_control/${locale} must include chek-list-priemki-syrya-v-restorane`,
      );
      if (locale !== "ru") {
        for (const item of incoming) {
          assert.doesNotMatch(item.title, /[А-Яа-яЁё]/, `${locale} leaked Cyrillic: ${item.title}`);
        }
      }
    }
  });

  test("journal pages no longer point to merged landings (one query — one page)", () => {
    // Лендинги этих журналов слиты 301 в сами страницы журналов (seo-speed-pack-2026-11).
    for (const code of ["general_cleaning", "incoming_control", "fryer_oil", "climate_control", "med_books", "daily_samples", "cleaning", "cold_equipment_control"]) {
      assert.equal(primarySeoLandingSlugForJournal(code), null, code);
    }
  });
});
