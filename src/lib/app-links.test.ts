import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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

// ── Один набор ссылок на сайте (iOS) и в приложении Android ─────────────────
// iOS берёт пути из файла apple-app-site-association, который строится из
// APP_LINK_PATHS. Android — из intent-filter в AndroidManifest.xml, зашитого
// в приложение. Разойдутся — одна и та же ссылка с QR откроется в приложении
// на одном телефоне и в браузере на другом.

type AndroidLinkData = { path?: string; pathPrefix?: string };

/** <data android:path|pathPrefix> из intent-filter с autoVerify (App Links). */
function androidAppLinkData(): AndroidLinkData[] {
  const xml = readFileSync(path.join(process.cwd(), "mobile/android/app/src/main/AndroidManifest.xml"), "utf8");
  const filter = xml.match(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/);
  assert.ok(filter, "в AndroidManifest.xml нет intent-filter с autoVerify");
  assert.match(filter[1], /android:scheme="https"/);
  assert.match(filter[1], /android:host="wesetup\.ru"/);
  return [...filter[1].matchAll(/<data android:(path|pathPrefix)="([^"]+)"\s*\/>/g)].map((m) => ({ [m[1]]: m[2] }));
}

/** Как сравнивает Apple: «*» — любые символы, остальное буквально. */
function iosOpensInApp(urlPath: string): boolean {
  return APP_LINK_PATHS.some((pattern) => {
    const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return re.test(urlPath);
  });
}

/** Как сравнивает Android: path — целиком, pathPrefix — начало строки. */
function androidOpensInApp(data: AndroidLinkData[], urlPath: string): boolean {
  return data.some((d) => (d.path !== undefined ? d.path === urlPath : urlPath.startsWith(d.pathPrefix ?? "\u0000")));
}

test("Android открывает в приложении ровно те пути, что и iOS: «/x» → path, «/x/*» → pathPrefix «/x/»", () => {
  const expected = APP_LINK_PATHS.map((p) => (p.endsWith("/*") ? `pathPrefix=${p.slice(0, -1)}` : `path=${p}`)).sort();
  const actual = androidAppLinkData()
    .map((d) => (d.path !== undefined ? `path=${d.path}` : `pathPrefix=${d.pathPrefix}`))
    .sort();
  assert.deepEqual(actual, expected);
  for (const p of APP_LINK_PATHS) {
    assert.ok(/^\/[a-z0-9-]+(\/\*)?$/.test(p), `путь ${p}: только «/раздел» или «/раздел/*»`);
  }
});

test("QR, вход и кабинет открываются в приложении на обеих платформах, витрина — в браузере", () => {
  const data = androidAppLinkData();
  const inside = [
    "/mini",
    "/mini/today",
    "/mini/journals/hygiene",
    "/journals/hygiene/documents/abc",
    "/q/token123",
    "/qj/org1/hygiene/sig",
    "/pair/token123",
    "/invite/token123",
    "/join/token123",
    "/journal-fill/org1/hygiene",
    "/equipment-fill/eq1",
    "/room-fill/room1",
    "/task-fill/task1",
    "/delete-account",
  ];
  const outside = [
    "/",
    "/pricing",
    "/journals-info/hygiene",
    "/qb/token123",
    "/b/abc",
    "/inspector/token/hygiene",
    "/r/code",
    "/mini-sw.js",
    "/delete-account/extra",
    "/login",
  ];
  for (const p of inside) {
    assert.ok(iosOpensInApp(p), `iOS: ${p} должен открываться в приложении`);
    assert.ok(androidOpensInApp(data, p), `Android: ${p} должен открываться в приложении`);
  }
  for (const p of outside) {
    assert.ok(!iosOpensInApp(p), `iOS: ${p} должен остаться в браузере`);
    assert.ok(!androidOpensInApp(data, p), `Android: ${p} должен остаться в браузере`);
  }
});
