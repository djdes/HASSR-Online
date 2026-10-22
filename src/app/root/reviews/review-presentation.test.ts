import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "next-intl";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { reviewSocialText, type ReviewView } from "@/lib/balance/review-view";
import { formatPoints, reviewRewardFor } from "@/lib/balance/constants";
import { formatReviewDate, localizedReviewSocialText, reviewKindLabel, reviewSphere } from "./review-presentation";

const catalogs = { ru, en, uz };
const review: ReviewView = {
  id: "review-1", organizationId: "org-1", organizationName: "Ресторан",
  userId: "user-1", authorName: "Анонимный отзыв", place: "Кафе / Кофейня",
  text: "Наш журнал Oʻtkir\nОставить исходный текст", kind: "video",
  mediaUrl: "https://files.invalid/video.mp4", mediaMime: "video/mp4", rating: 5,
  consentPublic: true, anonymous: false, organizationSphere: "Ресторан",
  status: "pending", rewardRub: 0, suggestedRewardRub: 1990,
  rejectReason: null, showOnLanding: true, createdAt: "2026-10-16T00:30:00Z", moderatedAt: null,
};

test("clipboard preserves raw nonanonymous names, empty signature, content and original RU bytes", () => {
  const snapshot = JSON.stringify(review);
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootReviews" });
    for (const item of [review, { ...review, authorName: "", place: "", mediaUrl: null }]) {
      const output = localizedReviewSocialText(item, t);
      const original = reviewSocialText(item);
      assert.equal(output, original.replace(ru.rootReviews.clipboardBrand, t("clipboardBrand")));
    }
  }
  assert.equal(JSON.stringify(review), snapshot);
});

test("only explicit anonymous flag changes author; unknown kinds and unproven spheres remain literal", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootReviews" });
    for (const sphere of ["Ресторан", "custom Oʻtkir", "__proto__", "constructor", null]) {
      const item = { ...review, anonymous: true, organizationSphere: sphere };
      const output = localizedReviewSocialText(item, t);
      assert.ok(output.includes(`— ${t("anonymousAuthor")}${sphere ? ", " + sphere : ""}\n`));
      assert.ok(!output.includes(review.place));
      if (locale === "ru") assert.equal(output, reviewSocialText(item));
    }
    for (const kind of ["__proto__", "constructor", "custom", ""]) assert.equal(reviewKindLabel(kind, t), kind);
    assert.equal(reviewKindLabel("text", t), t("kindText"));
    assert.equal(reviewKindLabel("photo", t), t("kindPhoto"));
    assert.equal(reviewKindLabel("video", t), t("kindVideo"));
  }
});

test("dates preserve native RU host timezone and invalid text; rewards stay original amounts", () => {
  for (const value of [review.createdAt, "1900-01-01T00:00:00Z", "2024-02-29T23:59:00Z", "invalid"]) {
    assert.equal(formatReviewDate(value, "ru"), new Date(value).toLocaleDateString("ru-RU"));
  }
  for (const locale of ["ru", "en", "uz"] as const) assert.equal(formatReviewDate("invalid", locale), "Invalid Date");
  assert.deepEqual(["text", "photo", "video"].map(kind => reviewRewardFor(kind as "text" | "photo" | "video")), [300, 750, 1990]);
  assert.equal(formatPoints(reviewRewardFor("video", true)), "1 592 ₽");
});

test("sphere copy requires stable queried origin, with guarded aliases and literal unproved values", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootReviews" });
    for (const origin of ["restaurant", " RESTAURANT "]) assert.equal(reviewSphere({ ...review, organizationTypeOrigin: origin }, t), t("sphereRestaurant"));
    for (const origin of ["meat", "dairy", "production"]) assert.equal(reviewSphere({ ...review, organizationTypeOrigin: origin }, t), t("sphereProduction"));
    for (const origin of [undefined, null, "Ресторан", "unknown", "other", "__proto__", "constructor"]) assert.equal(reviewSphere({ ...review, organizationTypeOrigin: origin }, t), "Ресторан");
    assert.equal(reviewSphere({ ...review, organizationSphere: null, organizationTypeOrigin: "restaurant" }, t), "");
    const named = { ...review, organizationTypeOrigin: "restaurant" };
    assert.ok(localizedReviewSocialText(named, t).includes(`— ${review.authorName}, ${review.place}`));
    assert.ok(localizedReviewSocialText({ ...named, anonymous: true }, t).includes(`— ${t("anonymousAuthor")}, ${t("sphereRestaurant")}`));
  }
});
