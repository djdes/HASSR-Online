import test from "node:test";
import assert from "node:assert/strict";

import {
  appLoginHref,
  appStoreUrl,
  appUpdateRequirement,
  compareAppVersion,
  isMobileAppUserAgent,
  parseMobileAppUserAgent,
} from "./mobile-app";

test("распознаёт приписку приложения в User-Agent", () => {
  const ua =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile WeSetupApp/1.2.3 (android)";
  assert.deepEqual(parseMobileAppUserAgent(ua), { platform: "android", version: "1.2.3" });
  assert.deepEqual(
    parseMobileAppUserAgent("Mozilla/5.0 (iPhone) Mobile/15E148 WeSetupApp/1.0.0 (ios)"),
    { platform: "ios", version: "1.0.0" }
  );
  assert.equal(isMobileAppUserAgent(ua), true);
});

test("чужие User-Agent приложением не считаются", () => {
  assert.equal(isMobileAppUserAgent("Mozilla/5.0 Telegram-iOS/11.2"), false);
  assert.equal(isMobileAppUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/128"), false);
  assert.equal(parseMobileAppUserAgent(null), null);
  assert.equal(parseMobileAppUserAgent(undefined), null);
  assert.equal(parseMobileAppUserAgent(""), null);
  assert.equal(parseMobileAppUserAgent("WeSetupApp/1.0.0 (windows)"), null);
  assert.equal(parseMobileAppUserAgent("NotWeSetupApp/1.0.0 (ios)"), null);
});

test("сравнивает версии по числам, а не строкой", () => {
  assert.equal(compareAppVersion("1.10.0", "1.9.9"), 1);
  assert.equal(compareAppVersion("1.2.0", "1.2"), 0);
  assert.equal(compareAppVersion("0.9.0", "1.0.0"), -1);
  assert.equal(compareAppVersion("1.0.0", "1.0.0"), 0);
  assert.equal(compareAppVersion(" 2.0 ", "1.99.99"), 1);
});

test("просьба обновиться — только приложению старше минимальной версии", () => {
  const old = "Mozilla/5.0 Mobile WeSetupApp/0.9.0 (android)";
  const fresh = "Mozilla/5.0 Mobile WeSetupApp/1.0.0 (ios)";
  assert.deepEqual(appUpdateRequirement(old, "1.0.0"), { platform: "android", version: "0.9.0" });
  assert.equal(appUpdateRequirement(fresh, "1.0.0"), null);
  // Без переменной окружения ничего не проверяем.
  assert.equal(appUpdateRequirement(old, ""), null);
  assert.equal(appUpdateRequirement(old, undefined), null);
  assert.equal(appUpdateRequirement(old, "  "), null);
  // Мусор в переменной не запирает всех в экране обновления.
  assert.equal(appUpdateRequirement(old, "latest"), null);
  // Сайт в браузере и Telegram не трогаем.
  assert.equal(appUpdateRequirement("Mozilla/5.0 Chrome/128", "9.9.9"), null);
});

test("ссылка на магазин по платформе", () => {
  assert.equal(
    appStoreUrl("android", "123"),
    "https://play.google.com/store/apps/details?id=ru.wesetup.app"
  );
  assert.equal(appStoreUrl("ios", "6412345678"), "https://apps.apple.com/app/id6412345678");
  assert.equal(appStoreUrl("ios", ""), "https://apps.apple.com/ru/search?term=WeSetup");
  assert.equal(appStoreUrl("ios", undefined), "https://apps.apple.com/ru/search?term=WeSetup");
  assert.equal(appStoreUrl("ios", "id64/../x"), "https://apps.apple.com/ru/search?term=WeSetup");
});

test("вход сайта в приложении ведёт на вход приложения с тем же возвратом", () => {
  assert.equal(appLoginHref(null), "/mini/login");
  assert.equal(appLoginHref(""), "/mini/login");
  assert.equal(
    appLoginHref("/room-fill/r1?token=room%3Ar1.1.sig"),
    "/mini/login?next=%2Froom-fill%2Fr1%3Ftoken%3Droom%253Ar1.1.sig"
  );
  assert.equal(appLoginHref("/mini"), "/mini/login");
  // Чужой адрес и API в возврат не попадают.
  assert.equal(appLoginHref("//evil.example/x"), "/mini/login");
  assert.equal(appLoginHref("https://evil.example"), "/mini/login");
  assert.equal(appLoginHref("/api/auth/session"), "/mini/login");
});
