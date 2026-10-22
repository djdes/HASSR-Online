import assert from "node:assert/strict";
import test from "node:test";
import baseManifest from "../../public/manifest.json";
import { buildLocalizedPwaManifest, pwaManifestHref } from "./pwa-manifest-localization";

const copy = { name: "Localized name", description: "Localized description", todayName: "Today", todayDescription: "Current shift", journalsName: "Logs", journalsDescription: "List of logs" };

test("every localized PWA retains installation identity, launch URLs, scope and all non-copy fields", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const localized = buildLocalizedPwaManifest(locale, copy);
    const original = structuredClone(baseManifest);
    localized.lang = original.lang;
    localized.name = original.name;
    localized.description = original.description;
    localized.shortcuts = localized.shortcuts.map((shortcut, index) => ({ ...shortcut, name: original.shortcuts[index].name, short_name: original.shortcuts[index].short_name, description: original.shortcuts[index].description }));
    assert.deepEqual(localized, original);
    assert.equal(pwaManifestHref(locale), locale === "ru" ? "/manifest.json" : `/manifest-${locale}.json`);
    assert.equal(new URL(original.start_url, "https://fixture.invalid").pathname, original.id);
  }
});

test("PWA output cannot mutate the shared base or another locale result", () => {
  const before = structuredClone(baseManifest);
  const first = buildLocalizedPwaManifest("en", copy);
  first.icons[0].src = "/caller-mutation.png";
  first.shortcuts[0].url = "/caller-mutation";
  first.name = "Caller mutation";
  assert.deepEqual(baseManifest, before);
  assert.deepEqual(buildLocalizedPwaManifest("uz", copy).icons, before.icons);
  assert.equal(buildLocalizedPwaManifest("uz", copy).shortcuts[0].url, before.shortcuts[0].url);
});
