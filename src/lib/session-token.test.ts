import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_SESSION_COOKIES,
  SESSION_COOKIE_DEV,
  SESSION_COOKIE_PROD,
} from "@/lib/auth-cookies";
import { findSessionCookieName } from "@/lib/session-token";

/** Сессия, выданная до перехода на одно имя: токен во всех именах сразу. */
const OLD_LOGIN = new Set(ALL_SESSION_COOKIES);

test("findSessionCookieName: на проде — кука next-auth, как у читателей", () => {
  // `server-session.ts` и proxy берут первое имя в порядке
  // `sessionCookieReadOrder`. Если здесь порядок другой, правка claim'а
  // уйдёт не в ту cookie и просто не подействует.
  assert.equal(findSessionCookieName((name) => OLD_LOGIN.has(name), true), SESSION_COOKIE_PROD);
});

test("findSessionCookieName: в dev — своё имя next-auth", () => {
  assert.equal(findSessionCookieName((name) => OLD_LOGIN.has(name), false), SESSION_COOKIE_DEV);
});

test("findSessionCookieName: без актуальной куки — запасное имя", () => {
  // Старая вкладка или сессия до правки: актуальной cookie нет.
  assert.equal(
    findSessionCookieName((name) => name === "next-auth.session-token", true),
    "next-auth.session-token",
  );
  assert.equal(findSessionCookieName((name) => name === SESSION_COOKIE_DEV, true), SESSION_COOKIE_DEV);
});

test("findSessionCookieName returns null without a session", () => {
  assert.equal(findSessionCookieName(() => false, true), null);
  assert.equal(findSessionCookieName(() => false, false), null);
});
