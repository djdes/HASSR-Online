import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  parseThemeCookie,
  pickInitialTheme,
  themeCookieString,
} from "./theme-cookie";

describe("кука темы устройства", () => {
  it("принимает только светлую и тёмную", () => {
    assert.equal(parseThemeCookie("light"), "light");
    assert.equal(parseThemeCookie("dark"), "dark");
    for (const bad of ["system", "", "Dark", "dark;", null, undefined]) {
      assert.equal(parseThemeCookie(bad), null, String(bad));
    }
  });

  it("первый кадр — в теме этого устройства, даже если в профиле другая", () => {
    assert.equal(pickInitialTheme("dark", "light"), "dark");
    assert.equal(pickInitialTheme("light", "dark"), "light");
  });

  it("новое устройство (куки нет) — тема профиля, без профиля — светлая", () => {
    assert.equal(pickInitialTheme(undefined, "dark"), "dark");
    assert.equal(pickInitialTheme(null, "light"), "light");
    assert.equal(pickInitialTheme(undefined, null), "light");
    assert.equal(pickInitialTheme("мусор", "dark"), "dark");
  });

  it("кука — на весь сайт, надолго, без утечки на чужие сайты", () => {
    const value = themeCookieString("dark");
    assert.match(value, new RegExp(`^${THEME_COOKIE}=dark;`));
    assert.match(value, /; Path=\/;/);
    assert.match(value, new RegExp(`Max-Age=${THEME_COOKIE_MAX_AGE}`));
    assert.match(value, /SameSite=Lax/);
    assert.ok(THEME_COOKIE_MAX_AGE >= 60 * 60 * 24 * 365);
  });
});
