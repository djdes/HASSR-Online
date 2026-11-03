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

  test("maps catalog journal codes to commercial SEO landing slugs", () => {
    assert.equal(primarySeoLandingSlugForJournal("general_cleaning"), "zhurnal-generalnyh-uborok");
    assert.equal(primarySeoLandingSlugForJournal("incoming_control"), "zhurnal-vhodnogo-kontrolya");
    assert.equal(primarySeoLandingSlugForJournal("fryer_oil"), "zhurnal-frityurnyh-zhirov");
    assert.equal(primarySeoLandingSlugForJournal("climate_control"), "zhurnal-temperatury-i-vlazhnosti");
    assert.equal(primarySeoLandingSlugForJournal("med_books"), "zhurnal-medknizhek");
    assert.equal(primarySeoLandingSlugForJournal("daily_samples"), "zhurnal-sutochnyh-prob");
  });
});
