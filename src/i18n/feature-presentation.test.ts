import assert from "node:assert/strict";
import test from "node:test";
import { FEATURES_INFO, FEATURES_ORDER } from "@/content/features";
import { messageArguments } from "./catalog-validation";
import { FEATURE_COPY_MANIFEST, isFeatureSlug, presentFeature } from "./feature-presentation";
import { featureMetadata } from "./feature-metadata";
import { loadMessages } from "./messages";
import { localizedHref, publicLocaleRoute, siteLanguageAlternates } from "./site-locale";

test("all feature text slots have stable typed copy and retain original source structure across three languages", async () => {
  const original = structuredClone(FEATURES_INFO);
  assert.deepEqual(Object.keys(FEATURE_COPY_MANIFEST), FEATURES_ORDER);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const slug of FEATURES_ORDER) {
      assert.ok(isFeatureSlug(slug));
      const source = FEATURES_INFO[slug], shown = presentFeature(slug, messages);
      assert.equal(shown.slug, source.slug);assert.equal(shown.iconName, source.iconName);
      assert.equal(shown.body.length, source.body.length);
      assert.equal(shown.title, messages.publicFeatures.features[slug].title);
      assert.equal(shown.tagline, messages.publicFeatures.features[slug].tagline);
      assert.notEqual(shown, source);
      if (locale === "ru") assert.deepEqual(shown, source);
      else assert.ok(!/[А-Яа-яЁё]/u.test(JSON.stringify(shown)), `${locale}/${slug}`);
      for (const value of Object.values(messages.publicFeatures.features[slug])) assert.deepEqual(messageArguments(value), [], `${locale}/${slug}: body copy has no implicit parameters`);
      shown.body.forEach((block, index) => {
        const before = source.body[index];assert.equal(block.type, before.type);
        if ((block.type === "ul" || block.type === "ol") && (before.type === "ul" || before.type === "ol")) assert.equal(block.items.length, before.items.length);
        if (block.type === "callout" && before.type === "callout") assert.equal(block.tone, before.tone);
      });
    }
  }
  assert.deepEqual(FEATURES_INFO, original);
  for (const value of ["missing", "constructor", "__proto__", "toString", "qr/other"]) assert.equal(isFeatureSlug(value), false);
});

test("feature metadata, sharing images and explicit public routes agree on each locale without touching private/API/QR paths", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const slug of [undefined, ...FEATURES_ORDER]) {
      const path = slug ? `/features/${slug}` : "/features";
      const result = await featureMetadata(locale, slug);
      const expected = `https://wesetup.ru${localizedHref(path, locale)}`;
      assert.equal(result.alternates?.canonical, expected);
      assert.deepEqual(result.alternates?.languages, siteLanguageAlternates(path));
      assert.equal(String(result.openGraph?.url), expected);
      assert.deepEqual(publicLocaleRoute(localizedHref(path, locale)), {locale,pathname:path});
      assert.equal(localizedHref(`${path}?mode=original#section`, locale), `${localizedHref(path,locale)}?mode=original#section`);
      const images = result.openGraph?.images;assert.ok(Array.isArray(images));
      const image = images[0];assert.ok(image && typeof image === "object");
      assert.ok("url" in image);
      const url = new URL(String(image.url));assert.equal(url.searchParams.get("l"), locale);
      assert.equal(url.searchParams.get("k"), "feature");assert.equal(url.searchParams.get("t"), result.title);
      assert.equal(result.description, slug && isFeatureSlug(slug) ? messages.publicFeatures.features[slug].tagline : messages.publicFeatures.index.metadataDescription);
    }
    for (const slug of ["missing","constructor","__proto__"]) assert.deepEqual((await featureMetadata(locale,slug)).title,{absolute:messages.publicFeatures.detail.notFound});
    for (const path of ["/api/features", "/journals/qr", "/room-fill/room?token=original", "/settings", "/api/auth/callback/telegram"]) assert.equal(localizedHref(path, locale),path);
  }
});
