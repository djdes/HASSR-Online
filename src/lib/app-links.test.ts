import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_BUNDLE_ID,
  APP_LINK_PATHS,
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  parseCertFingerprints,
} from "@/lib/app-links";

test("файл Apple содержит приложение, пути и ключи доступа", () => {
  const aasa = buildAppleAppSiteAssociation("ABCDE12345", "ru.wesetup.app");
  assert.deepEqual(aasa.applinks.details[0].appIDs, ["ABCDE12345.ru.wesetup.app"]);
  assert.ok(aasa.applinks.details[0].components.some((c) => c["/"] === "/mini/*"));
  assert.ok(aasa.applinks.details[0].components.some((c) => c["/"] === "/mini"));
  assert.deepEqual(aasa.webcredentials.apps, ["ABCDE12345.ru.wesetup.app"]);
  assert.ok(APP_LINK_PATHS.includes("/journal-fill/*"));
  assert.equal(APP_BUNDLE_ID, "ru.wesetup.app");
});

test("Team ID чистится от пробелов", () => {
  const aasa = buildAppleAppSiteAssociation("  ABCDE12345 ", APP_BUNDLE_ID);
  assert.deepEqual(aasa.applinks.details[0].appIDs, ["ABCDE12345.ru.wesetup.app"]);
});

test("файл Android содержит пакет и отпечатки", () => {
  const links = buildAssetLinks("ru.wesetup.app", ["AA:BB", " CC:DD "]);
  assert.equal(links[0].target.namespace, "android_app");
  assert.equal(links[0].target.package_name, "ru.wesetup.app");
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, ["AA:BB", "CC:DD"]);
  assert.ok(links[0].relation.includes("delegate_permission/common.handle_all_urls"));
  assert.ok(links[0].relation.includes("delegate_permission/common.get_login_creds"));
});

test("отпечатки из переменной окружения: через запятую, без пустых и повторов, в верхнем регистре", () => {
  assert.deepEqual(parseCertFingerprints(undefined), []);
  assert.deepEqual(parseCertFingerprints(""), []);
  assert.deepEqual(parseCertFingerprints(" , "), []);
  assert.deepEqual(parseCertFingerprints("aa:bb, CC:DD ,AA:BB"), ["AA:BB", "CC:DD"]);
});
