import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP_ID, APP_URL, checkRelease } from "./release-preflight.mjs";

function fixture(t, platform = "android") {
  const root = mkdtempSync(path.join(tmpdir(), "wesetup-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  const config = { appId: APP_ID, server: { url: APP_URL, cleartext: false, allowNavigation: ["wesetup.ru", "www.wesetup.ru"], errorPath: "offline.html" }, [platform]: { appendUserAgent: `WeSetupApp/1.0.0 (${platform})` } };
  const configPath = platform === "android" ? "android/app/src/main/assets/capacitor.config.json" : "ios/App/App/capacitor.config.json";
  put("package.json", { version: "1.0.0" });
  put(configPath, config);
  put("www/offline.html", "<html>Offline</html>");
  put("android/app/upload.jks", "test-fixture-only");
  put("android/app/google-services.json", { project_info: { project_id: "test", project_number: "123" }, client: [{ client_info: { android_client_info: { package_name: APP_ID }, mobilesdk_app_id: "1:123:android:test" }, api_key: [{ current_key: "fixture" }] }] });
  put("ios/App/App/GoogleService-Info.plist", `<plist><dict><key>BUNDLE_ID</key><string>${APP_ID}</string><key>GOOGLE_APP_ID</key><string>1:123:ios:test</string><key>PROJECT_ID</key><string>test</string><key>GCM_SENDER_ID</key><string>123</string><key>API_KEY</key><string>fixture</string></dict></plist>`);
  put("test.p8", "fixture");
  const env = { BUILD_NUMBER: "7", ANDROID_KEYSTORE_PASSWORD: "secret-do-not-log", ANDROID_KEY_ALIAS: "upload", ANDROID_KEY_PASSWORD: "secret-do-not-log", APPLE_TEAM_ID: "ABCDEFGHIJ", ASC_KEY_ID: "1234567890", ASC_ISSUER_ID: "12345678-1234-1234-1234-123456789012", ASC_KEY_PATH: path.join(root, "test.p8") };
  return { root, platform, env, put, config, configPath };
}

test("complete production configurations pass for both platforms", (t) => {
  for (const platform of ["android", "ios"]) assert.deepEqual(checkRelease(fixture(t, platform)), []);
});
test("a generated emulator URL, cleartext or foreign host blocks release", (t) => {
  for (const mutate of [
    (f) => { f.config.server.url = "http://10.0.2.2:3000/mini"; },
    (f) => { f.config.server.cleartext = true; },
    (f) => { f.config.server.allowNavigation.push("*"); },
  ]) {
    const f = fixture(t); mutate(f); f.put(f.configPath, f.config);
    assert.ok(checkRelease(f).length);
  }
});
test("test override and mismatched platform version block release", (t) => {
  const f = fixture(t); f.env.WESETUP_APP_URL = APP_URL;
  assert.ok(checkRelease(f).some((e) => e.includes("WESETUP_APP_URL")));
  delete f.env.WESETUP_APP_URL; f.config.android.appendUserAgent = "WeSetupApp/0.1.0 (android)"; f.put(f.configPath, f.config);
  assert.ok(checkRelease(f).some((e) => e.includes("User-Agent")));
});
test("missing signing credentials fail without leaking their values", (t) => {
  const f = fixture(t); delete f.env.ANDROID_KEY_PASSWORD;
  const errors = checkRelease(f);
  assert.ok(errors.some((e) => e.includes("ANDROID_KEY_PASSWORD")));
  assert.ok(!JSON.stringify(errors).includes("secret-do-not-log"));
});
test("missing or wrong Firebase identity cannot silently disable push", (t) => {
  const f = fixture(t); f.put("android/app/google-services.json", { project_info: { project_id: "test" }, client: [] });
  assert.ok(checkRelease(f).some((e) => e.includes("Firebase Android")));
  const i = fixture(t, "ios"); i.put("ios/App/App/GoogleService-Info.plist", "<plist></plist>");
  assert.ok(checkRelease(i).some((e) => e.includes("Firebase iOS")));
});
test("invalid versions, numbers and malformed configuration are rejected", (t) => {
  for (const value of ["0", "-1", "1.2", "2100000001", "x"]) {
    const f = fixture(t); f.env.BUILD_NUMBER = value;
    assert.ok(checkRelease(f).some((e) => e.includes("BUILD_NUMBER")));
  }
  const f = fixture(t); f.put("package.json", { version: "1.0.0-beta" }); f.put(f.configPath, "{");
  assert.ok(checkRelease(f).some((e) => e.includes("version")));
  assert.ok(checkRelease(f).some((e) => e.includes("Invalid JSON")));
});
