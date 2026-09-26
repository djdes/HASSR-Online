import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import {
  ALL_SESSION_COOKIES,
  LEGACY_AUX_COOKIES,
  SESSION_COOKIE_DEV,
  SESSION_COOKIE_PROD,
  expireSessionCookies,
  expireSignOutCookies,
  expiredCookieOptions,
  pickSessionCookie,
  serializeExpiredCookie,
  sessionCookieName,
  sessionCookieReadOrder,
  setSessionCookie,
  staleSessionCookieNames,
  withOnlyCurrentSessionCookie,
  type CookieOptions,
} from "@/lib/auth-cookies";
import { MINI_SHELL_COOKIE } from "@/lib/mini-shell-cookie";

/** Запись в «банку» кук — как `response.cookies.set`, только с журналом. */
function recordingJar() {
  const calls: Array<{ name: string; value: string; options: CookieOptions }> = [];
  return {
    calls,
    set(name: string, value: string, options: CookieOptions) {
      calls.push({ name, value, options });
    },
  };
}

/** Разбор `Set-Cookie`: имя, значение и атрибуты (без учёта регистра). */
function parseSetCookie(line: string) {
  const [pair, ...attrs] = line.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  const lower = attrs.map((attr) => attr.toLowerCase());
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    attrs: lower,
    has: (attr: string) => lower.some((a) => a === attr || a.startsWith(`${attr}=`)),
    get: (attr: string) => lower.find((a) => a.startsWith(`${attr}=`))?.slice(attr.length + 1) ?? null,
  };
}

/** Кука удаляется: пустое значение и срок в прошлом. */
function isExpiry(line: ReturnType<typeof parseSetCookie>): boolean {
  return line.value === "" && (line.get("max-age") === "0" || /1970/.test(line.get("expires") ?? ""));
}

test("актуальное имя: на проде — __Secure-, в dev — без префикса (как у next-auth)", () => {
  assert.equal(sessionCookieName(true), "__Secure-haccp-online.session-token");
  assert.equal(sessionCookieName(false), "haccp-online.session-token");
  assert.equal(SESSION_COOKIE_PROD, sessionCookieName(true));
  assert.equal(SESSION_COOKIE_DEV, sessionCookieName(false));
});

test("все имена сессии известны: актуальные обоих окружений и два легаси", () => {
  assert.deepEqual([...ALL_SESSION_COOKIES].sort(), [
    "__Secure-haccp-online.session-token",
    "__Secure-next-auth.session-token",
    "haccp-online.session-token",
    "next-auth.session-token",
  ]);
});

test("порядок чтения: актуальное имя первым, прочие — запасные", () => {
  const prod = sessionCookieReadOrder(true);
  assert.equal(prod[0], SESSION_COOKIE_PROD);
  assert.deepEqual([...prod].sort(), [...ALL_SESSION_COOKIES].sort());
  const dev = sessionCookieReadOrder(false);
  assert.equal(dev[0], SESSION_COOKIE_DEV);
  assert.deepEqual([...dev].sort(), [...ALL_SESSION_COOKIES].sort());
});

test("устаревшие имена — все, кроме актуального", () => {
  assert.ok(!staleSessionCookieNames(true).includes(SESSION_COOKIE_PROD));
  assert.ok(staleSessionCookieNames(true).includes(SESSION_COOKIE_DEV));
  assert.equal(staleSessionCookieNames(true).length, ALL_SESSION_COOKIES.length - 1);
  assert.ok(!staleSessionCookieNames(false).includes(SESSION_COOKIE_DEV));
  assert.ok(staleSessionCookieNames(false).includes(SESSION_COOKIE_PROD));
});

test("pickSessionCookie на проде: кука next-auth важнее своей старой (баг «два аккаунта»)", () => {
  // До правки proxy и getServerSession брали `haccp-online.session-token`
  // первым: после входа B через next-auth (Telegram) у них оставался A.
  const jar: Record<string, string> = {
    [SESSION_COOKIE_DEV]: "token-A",
    [SESSION_COOKIE_PROD]: "token-B",
    "next-auth.session-token": "token-A",
  };
  assert.deepEqual(pickSessionCookie((name) => jar[name], true), { name: SESSION_COOKIE_PROD, value: "token-B" });
});

test("pickSessionCookie в dev: актуальное имя без префикса", () => {
  const jar: Record<string, string> = {
    [SESSION_COOKIE_DEV]: "token-B",
    "next-auth.session-token": "token-A",
  };
  assert.deepEqual(pickSessionCookie((name) => jar[name], false), { name: SESSION_COOKIE_DEV, value: "token-B" });
});

test("pickSessionCookie: без актуальной куки — запасная, пустые значения не в счёт", () => {
  const jar: Record<string, string> = { [SESSION_COOKIE_PROD]: "", "next-auth.session-token": "legacy" };
  assert.deepEqual(pickSessionCookie((name) => jar[name], true), { name: "next-auth.session-token", value: "legacy" });
  assert.equal(pickSessionCookie(() => undefined, true), null);
  assert.equal(pickSessionCookie(() => null, false), null);
});

test("удаление: __Secure-/__Host- всегда с Secure (иначе браузер не удалит), путь /, срок в прошлом", () => {
  for (const production of [true, false]) {
    const secureName = expiredCookieOptions("__Secure-haccp-online.session-token", production);
    assert.equal(secureName.secure, true, `production=${production}`);
    assert.equal(secureName.path, "/");
    assert.equal(secureName.maxAge, 0);
    assert.equal(secureName.expires?.getTime(), 0);
    assert.equal(expiredCookieOptions("__Host-next-auth.csrf-token", production).secure, true);
  }
  // Без префикса — как при установке: Secure только на проде.
  assert.equal(expiredCookieOptions(SESSION_COOKIE_DEV, true).secure, true);
  assert.equal(expiredCookieOptions(SESSION_COOKIE_DEV, false).secure, false);
});

test("serializeExpiredCookie — строка удаления с совпадающими атрибутами", () => {
  const prod = parseSetCookie(serializeExpiredCookie(SESSION_COOKIE_DEV, true));
  assert.equal(prod.name, SESSION_COOKIE_DEV);
  assert.ok(isExpiry(prod));
  assert.equal(prod.get("path"), "/");
  assert.ok(prod.has("secure"));
  assert.ok(prod.has("httponly"));
  assert.ok(!prod.has("domain"), "кука host-only — удаление без Domain");
  const devSecure = parseSetCookie(serializeExpiredCookie(SESSION_COOKIE_PROD, false));
  assert.ok(devSecure.has("secure"), "__Secure- и в dev удаляется только с Secure");
  const devPlain = parseSetCookie(serializeExpiredCookie("next-auth.session-token", false));
  assert.ok(!devPlain.has("secure"));
});

test("вход (setSessionCookie): одна живая кука под актуальным именем, прочие гаснут", () => {
  for (const production of [true, false]) {
    const jar = recordingJar();
    setSessionCookie(jar, "fresh", 3600, production);
    const live = jar.calls.filter((call) => call.value !== "");
    assert.equal(live.length, 1, `production=${production}`);
    assert.equal(live[0].name, sessionCookieName(production));
    assert.equal(live[0].options.maxAge, 3600);
    assert.equal(live[0].options.httpOnly, true);
    assert.equal(live[0].options.secure, production);
    const expired = jar.calls.filter((call) => call.value === "").map((call) => call.name).sort();
    assert.deepEqual(expired, staleSessionCookieNames(production).sort());
  }
});

test("setSessionCookie на настоящем NextResponse: заголовки не теряются", () => {
  // `NextResponse.cookies.set` пересобирает все Set-Cookie из своей
  // таблицы — важно, что гашение и установка идут через неё.
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response.cookies, "fresh-token", 3600, true);
  const lines = response.headers.getSetCookie().map(parseSetCookie);
  const live = lines.filter((line) => line.value !== "");
  assert.deepEqual(live.map((line) => line.name), [SESSION_COOKIE_PROD]);
  assert.equal(live[0].value, "fresh-token");
  assert.ok(live[0].has("secure") && live[0].has("httponly"));
  for (const name of staleSessionCookieNames(true)) {
    const line = lines.find((l) => l.name === name);
    assert.ok(line && isExpiry(line), `не гасится ${name}`);
  }
});

test("expireSessionCookies гасит все имена, кроме keep", () => {
  const jar = recordingJar();
  expireSessionCookies(jar, { production: true, keep: SESSION_COOKIE_PROD });
  assert.deepEqual(jar.calls.map((call) => call.name).sort(), staleSessionCookieNames(true).sort());
  const all = recordingJar();
  expireSessionCookies(all, { production: false });
  assert.deepEqual(all.calls.map((call) => call.name).sort(), [...ALL_SESSION_COOKIES].sort());
});

test("выход (expireSignOutCookies): все имена сессии, служебные next-auth и оболочка", () => {
  for (const production of [true, false]) {
    const response = NextResponse.json({ success: true });
    expireSignOutCookies(response.cookies, production);
    const lines = response.headers.getSetCookie().map(parseSetCookie);
    for (const name of [...ALL_SESSION_COOKIES, ...LEGACY_AUX_COOKIES, MINI_SHELL_COOKIE]) {
      const line = lines.find((l) => l.name === name);
      assert.ok(line, `нет удаления ${name} (production=${production})`);
      assert.ok(isExpiry(line), `${name} не гаснет`);
      assert.equal(line.get("path"), "/");
      if (name.startsWith("__Secure-") || name.startsWith("__Host-")) assert.ok(line.has("secure"), `${name} без Secure`);
    }
    assert.equal(lines.filter((line) => line.value !== "").length, 0, "живых кук нет");
    const shell = lines.find((l) => l.name === MINI_SHELL_COOKIE);
    // Как `buildMiniShellClearCookie`: на проде — SameSite=None; Secure.
    assert.equal(shell?.get("samesite"), production ? "none" : "lax");
    assert.equal(shell?.has("secure"), production);
  }
});

test("ответ next-auth ставит куку сессии — прочие имена гасятся", () => {
  const upstream = new Response(JSON.stringify({ url: "/mini" }), { status: 200 });
  upstream.headers.append("Set-Cookie", `${SESSION_COOKIE_PROD}=jwt-B; Path=/; HttpOnly; Secure; SameSite=Lax`);
  const out = withOnlyCurrentSessionCookie(upstream, true);
  const lines = out.headers.getSetCookie().map(parseSetCookie);
  assert.equal(lines.find((l) => l.name === SESSION_COOKIE_PROD)?.value, "jwt-B", "свою куку next-auth не трогаем");
  for (const name of staleSessionCookieNames(true)) {
    const line = lines.find((l) => l.name === name);
    assert.ok(line && isExpiry(line), `после входа через next-auth осталась ${name}`);
  }
  assert.equal(out.status, 200);
});

test("signOut next-auth гасит свою куку — гаснут и запасные (выход из мастер-кабинета)", () => {
  const upstream = new Response(null, { status: 302, headers: { Location: "/login" } });
  upstream.headers.append("Set-Cookie", `${SESSION_COOKIE_DEV}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  const out = withOnlyCurrentSessionCookie(upstream, false);
  const names = out.headers.getSetCookie().map(parseSetCookie).filter(isExpiry).map((l) => l.name).sort();
  assert.deepEqual(names, [...ALL_SESSION_COOKIES].sort());
  assert.equal(out.status, 302);
  assert.equal(out.headers.get("location"), "/login");
});

test("ответ next-auth без куки сессии (csrf, providers) не меняется", () => {
  const upstream = new Response("{}", { status: 200 });
  upstream.headers.append("Set-Cookie", "haccp-online.csrf-token=abc; Path=/; SameSite=Lax");
  assert.equal(withOnlyCurrentSessionCookie(upstream, false), upstream);
  const bare = new Response("{}");
  assert.equal(withOnlyCurrentSessionCookie(bare, true), bare);
});

test("кусок большой куки next-auth (`<имя>.0`) тоже считается записью сессии", () => {
  const upstream = new Response("{}");
  upstream.headers.append("Set-Cookie", `${SESSION_COOKIE_PROD}.0=part; Path=/; Secure`);
  const out = withOnlyCurrentSessionCookie(upstream, true);
  assert.ok(out.headers.getSetCookie().some((line) => line.startsWith(`${SESSION_COOKIE_DEV}=;`)));
});
