// Тест проверки перед выпуском: node --test scripts/release-preflight.test.mjs
// (npm run test:release). Каждый случай собирает во временной папке копию
// того, что лежит в mobile/ на CI перед подписью, и портит одно место.
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
  const config = {
    appId: APP_ID,
    server: { url: APP_URL, cleartext: false, allowNavigation: ["wesetup.ru", "www.wesetup.ru"], errorPath: "offline.html" },
    [platform]: { appendUserAgent: `WeSetupApp/1.1.0 (${platform})` },
  };
  const configPath =
    platform === "android" ? "android/app/src/main/assets/capacitor.config.json" : "ios/App/App/capacitor.config.json";
  put("package.json", { version: "1.1.0" });
  put(configPath, config);
  put("www/offline.html", "<html>Offline</html>");
  put("android/app/upload.jks", "test-fixture-only");
  put("android/app/google-services.json", {
    project_info: { project_id: "test", project_number: "123" },
    client: [
      {
        client_info: { android_client_info: { package_name: APP_ID }, mobilesdk_app_id: "1:123:android:test" },
        api_key: [{ current_key: "fixture" }],
      },
    ],
  });
  put(
    "ios/App/App/GoogleService-Info.plist",
    `<plist><dict><key>BUNDLE_ID</key><string>${APP_ID}</string><key>GOOGLE_APP_ID</key><string>1:123:ios:test</string>` +
      `<key>PROJECT_ID</key><string>test</string><key>GCM_SENDER_ID</key><string>123</string><key>API_KEY</key><string>fixture</string></dict></plist>`,
  );
  put("test.p8", "fixture");
  const env = {
    BUILD_NUMBER: "7",
    ANDROID_KEYSTORE_PASSWORD: "secret-do-not-log",
    ANDROID_KEY_ALIAS: "upload",
    ANDROID_KEY_PASSWORD: "secret-do-not-log",
    APPLE_TEAM_ID: "ABCDEFGHIJ",
    ASC_KEY_ID: "1234567890",
    ASC_ISSUER_ID: "12345678-1234-1234-1234-123456789012",
    ASC_KEY_PATH: path.join(root, "test.p8"),
  };
  return { root, platform, env, put, config, configPath };
}

test("полная боевая конфигурация проходит на обеих платформах", (t) => {
  for (const platform of ["android", "ios"]) assert.deepEqual(checkRelease(fixture(t, platform)), []);
});

test("адрес эмулятора, http или чужой домен останавливают выпуск", (t) => {
  for (const mutate of [
    (f) => {
      f.config.server.url = "http://10.0.2.2:3000/mini";
    },
    (f) => {
      f.config.server.cleartext = true;
    },
    (f) => {
      f.config.server.allowNavigation.push("*");
    },
  ]) {
    const f = fixture(t);
    mutate(f);
    f.put(f.configPath, f.config);
    assert.ok(checkRelease(f).length);
  }
});

test("переменная автотестов и чужая версия в User-Agent останавливают выпуск", (t) => {
  const f = fixture(t);
  f.env.WESETUP_APP_URL = APP_URL;
  assert.ok(checkRelease(f).some((e) => e.includes("WESETUP_APP_URL")));
  delete f.env.WESETUP_APP_URL;
  f.config.android.appendUserAgent = "WeSetupApp/1.0.0 (android)";
  f.put(f.configPath, f.config);
  assert.ok(checkRelease(f).some((e) => e.includes("User-Agent")));
});

test("без паролей подписи — отказ с названием переменной, но без значений секретов", (t) => {
  const f = fixture(t);
  delete f.env.ANDROID_KEY_PASSWORD;
  const errors = checkRelease(f);
  assert.ok(errors.some((e) => e.includes("ANDROID_KEY_PASSWORD")));
  assert.ok(!JSON.stringify(errors).includes("secret-do-not-log"));
});

test("без ключа App Store Connect — отказ называет каждую недостающую переменную", (t) => {
  const f = fixture(t, "ios");
  delete f.env.APPLE_TEAM_ID;
  delete f.env.ASC_KEY_ID;
  f.env.ASC_ISSUER_ID = "not-a-uuid";
  const errors = checkRelease(f);
  for (const name of ["APPLE_TEAM_ID", "ASC_KEY_ID", "ASC_ISSUER_ID"]) {
    assert.ok(errors.some((e) => e.includes(name)), name);
  }
});

test("без Firebase или с Firebase чужого приложения push молча не пропадёт", (t) => {
  const f = fixture(t);
  f.put("android/app/google-services.json", { project_info: { project_id: "test" }, client: [] });
  assert.ok(checkRelease(f).some((e) => e.includes("Firebase Android")));
  const i = fixture(t, "ios");
  i.put("ios/App/App/GoogleService-Info.plist", "<plist></plist>");
  assert.ok(checkRelease(i).some((e) => e.includes("Firebase iOS")));
});

test("неверные номер сборки, версия и битый конфиг отклоняются", (t) => {
  for (const value of ["0", "-1", "1.2", "2100000001", "x"]) {
    const f = fixture(t);
    f.env.BUILD_NUMBER = value;
    assert.ok(checkRelease(f).some((e) => e.includes("BUILD_NUMBER")));
  }
  const f = fixture(t);
  f.put("package.json", { version: "1.1.0-beta" });
  f.put(f.configPath, "{");
  const errors = checkRelease(f);
  assert.ok(errors.some((e) => e.includes("Версия")));
  assert.ok(errors.some((e) => e.includes("не JSON")));
});

test("неизвестная платформа — отказ", () => {
  assert.deepEqual(checkRelease({ platform: "web" }), ["Платформа должна быть android или ios"]);
});
