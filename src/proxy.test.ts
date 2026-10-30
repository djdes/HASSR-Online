import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";

import { SESSION_COOKIE_DEV, SESSION_COOKIE_PROD } from "@/lib/auth-cookies";
import { proxy } from "@/proxy";

/**
 * Какую куку сессии читает proxy — на проде (`__Secure-…` у next-auth) и в
 * dev. A — сотрудник мастер-кабинета (proxy уводит его в /master), B —
 * руководитель обычной организации: по ответу на /dashboard видно, чей
 * токен proxy взял.
 */
const SECRET = "proxy-test-secret-0123456789abcdef";
const env = process.env as Record<string, string | undefined>;
const saved = { NODE_ENV: env.NODE_ENV, NEXTAUTH_SECRET: env.NEXTAUTH_SECRET };

let tokenA = "";
let tokenB = "";

async function mint(claims: Record<string, unknown>): Promise<string> {
  return encode({ secret: SECRET, token: claims as Parameters<typeof encode>[0]["token"] });
}

function request(path: string, cookies: Record<string, string>): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`https://wesetup.test${path}`, { headers: cookie ? { cookie } : {} });
}

/** Куда proxy отправил запрос: адрес редиректа или null (пропустил дальше). */
async function outcome(path: string, cookies: Record<string, string>): Promise<string | null> {
  const response = await proxy(request(path, cookies));
  const location = response.headers.get("location");
  if (location) return new URL(location).pathname;
  assert.equal(response.headers.get("x-middleware-next"), "1", "ни редиректа, ни пропуска");
  return null;
}

describe("proxy: какая кука сессии", () => {
  beforeEach(async () => {
    env.NEXTAUTH_SECRET = SECRET;
    tokenA = await mint({ sub: "user-a", id: "user-a", role: "manager", organizationId: "org-master", orgKind: "directory" });
    tokenB = await mint({ sub: "user-b", id: "user-b", role: "owner", organizationId: "org-cafe", orgKind: "regular" });
  });

  afterEach(() => {
    env.NODE_ENV = saved.NODE_ENV;
    env.NEXTAUTH_SECRET = saved.NEXTAUTH_SECRET;
  });

  it("на проде берёт куку next-auth, а не старую свою: вошёл B — proxy видит B", async () => {
    env.NODE_ENV = "production";
    // Состояние «двух аккаунтов»: A вошёл своим входом (все имена), B —
    // через next-auth (только `__Secure-…`). До правки proxy брал
    // `haccp-online.session-token` (A) и уводил B в мастер-кабинет A.
    const path = await outcome("/dashboard", {
      [SESSION_COOKIE_DEV]: tokenA,
      "next-auth.session-token": tokenA,
      [SESSION_COOKIE_PROD]: tokenB,
    });
    assert.equal(path, null);
  });

  it("на проде без актуальной куки — запасная (сессия, выданная до правки)", async () => {
    env.NODE_ENV = "production";
    assert.equal(await outcome("/dashboard", { [SESSION_COOKIE_DEV]: tokenA }), "/master");
    assert.equal(await outcome("/dashboard", { "__Secure-next-auth.session-token": tokenA }), "/master");
  });

  it("на проде актуальная кука важнее любой запасной и в обратную сторону", async () => {
    env.NODE_ENV = "production";
    assert.equal(
      await outcome("/dashboard", { [SESSION_COOKIE_PROD]: tokenA, [SESSION_COOKIE_DEV]: tokenB }),
      "/master",
    );
  });

  it("в dev актуальное имя — без префикса, как у next-auth в dev", async () => {
    env.NODE_ENV = "development";
    assert.equal(await outcome("/dashboard", { [SESSION_COOKIE_DEV]: tokenB, "next-auth.session-token": tokenA }), null);
    assert.equal(await outcome("/dashboard", { [SESSION_COOKIE_PROD]: tokenA, [SESSION_COOKIE_DEV]: tokenB }), null);
    assert.equal(await outcome("/dashboard", { "next-auth.session-token": tokenA }), "/master");
  });

  it("без кук сессии proxy пропускает (страница сама отправит на вход)", async () => {
    env.NODE_ENV = "production";
    assert.equal(await outcome("/dashboard", {}), null);
    // После выхода гаснут все имена — и мастер-кабинет больше не держит.
    assert.equal(await outcome("/login", {}), null);
  });

  it("сессия мастер-кабинета: /login открыт, страницы кабинета сайта — в /master", async () => {
    env.NODE_ENV = "production";
    assert.equal(await outcome("/login", { [SESSION_COOKIE_PROD]: tokenA }), null);
    assert.equal(await outcome("/journals", { [SESSION_COOKIE_PROD]: tokenA }), "/master");
  });
});

describe("proxy: уход из закрытого раздела объясняется (?denied=, 2026-10-29)", () => {
  beforeEach(() => {
    env.NEXTAUTH_SECRET = SECRET;
    env.NODE_ENV = "production";
  });

  afterEach(() => {
    env.NODE_ENV = saved.NODE_ENV;
    env.NEXTAUTH_SECRET = saved.NEXTAUTH_SECRET;
  });

  async function location(path: string, claims: Record<string, unknown>, extra: Record<string, string> = {}) {
    const token = await mint({ sub: "user-c", id: "user-c", organizationId: "org-cafe", orgKind: "regular", ...claims });
    const response = await proxy(request(path, { [SESSION_COOKIE_PROD]: token, ...extra }));
    const target = response.headers.get("location");
    return target ? new URL(target) : null;
  }

  it("сотрудник в разделе руководства — в «Журналы» с меткой, откуда увели", async () => {
    const target = await location("/settings/users", { role: "cook" });
    assert.equal(target?.pathname, "/journals");
    assert.equal(target?.searchParams.get("denied"), "/settings/users");
  });

  it("в оболочке приложения — на его главный экран, метка та же", async () => {
    const target = await location("/production-control", { role: "cook" }, { "ws-shell": "mini" });
    assert.equal(target?.pathname, "/mini");
    assert.equal(target?.searchParams.get("denied"), "/production-control");
  });

  it("домашняя сотрудника (/dashboard) — маршрут, а не отказ: без метки", async () => {
    const target = await location("/dashboard", { role: "cook" });
    assert.equal(target?.pathname, "/journals");
    assert.equal(target?.search, "");
  });

  it("руководитель точки на странице всей компании — на «Сегодня» с меткой", async () => {
    const target = await location("/settings/organization", { role: "manager", pointScope: ["b-1"] });
    assert.equal(target?.pathname, "/dashboard");
    assert.equal(target?.searchParams.get("denied"), "/settings/organization");
  });
});
