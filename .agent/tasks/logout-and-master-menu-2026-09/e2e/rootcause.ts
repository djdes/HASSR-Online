// Разбор причины на уровне HTTP, без браузера — одинаково на старом и новом коде:
//   PHASE=before|after BASE=http://localhost:3050 npx tsx .agent/tasks/logout-and-master-menu-2026-09/e2e/rootcause.ts
//
// Банка кук ведёт себя как браузер: `__Secure-`/`__Host-` без Secure не
// принимаются, `Max-Age=0`/прошедший `Expires` удаляют куку, localhost —
// «безопасный» адрес (Secure-куки на нём принимаются, как в Chrome).
//
// Сценарий — жалоба владельца: руководитель вошёл паролем, перешёл в
// мастер-кабинет, нажал «Выйти» (старая кнопка = `signOut` next-auth) — и?
import fs from "node:fs";
import path from "node:path";

import { ROOT } from "./db";
import { ORGS, PASSWORD, USERS } from "./fixtures";

const BASE = process.env.BASE ?? "http://localhost:3050";
const PHASE = process.env.PHASE === "before" ? "before" : "after";
const OUT = path.join(ROOT, ".agent", "tasks", "logout-and-master-menu-2026-09", "evidence", PHASE);
fs.mkdirSync(OUT, { recursive: true });

type Cookie = { value: string };
const jar = new Map<string, Cookie>();

function absorb(setCookies: string[]): string[] {
  const seen: string[] = [];
  for (const line of setCookies) {
    const [pair, ...rawAttrs] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const attrs = rawAttrs.map((a) => a.toLowerCase());
    const secure = attrs.includes("secure");
    if ((name.startsWith("__Secure-") || name.startsWith("__Host-")) && !secure) {
      seen.push(`${name}: ОТКЛОНЕНА браузером (префикс без Secure)`);
      continue;
    }
    const maxAge = attrs.find((a) => a.startsWith("max-age="));
    const expires = attrs.find((a) => a.startsWith("expires="));
    const expired =
      (maxAge !== undefined && Number(maxAge.slice(8)) <= 0) ||
      (expires !== undefined && new Date(expires.slice(8)).getTime() < Date.now());
    if (expired) {
      jar.delete(name);
      seen.push(`${name}: удалена`);
    } else {
      jar.set(name, { value });
      seen.push(`${name}: поставлена`);
    }
  }
  return seen;
}

function cookieHeader(): string {
  return [...jar.entries()].map(([name, c]) => `${name}=${c.value}`).join("; ");
}

const sessionCookies = () => [...jar.keys()].filter((name) => /session-token/.test(name)).sort();

async function http(method: string, p: string, body?: { json?: unknown; form?: Record<string, string> }) {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  let payload: string | undefined;
  if (body?.json !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body?.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body.form).toString();
  }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload, redirect: "manual", signal: AbortSignal.timeout(600_000) });
  const cookies = absorb(res.headers.getSetCookie());
  const location = res.headers.get("location");
  const text = await res.text();
  return { status: res.status, location: location ? new URL(location, BASE).pathname : null, cookies, text };
}

const steps: Array<Record<string, unknown>> = [];
function step(name: string, data: Record<string, unknown>) {
  steps.push({ step: name, ...data, jarSessionCookies: sessionCookies() });
  console.log(`[${PHASE}] ${name}`, JSON.stringify(data), "→ куки сессии:", sessionCookies().join(", ") || "нет");
}

async function main() {
  const login = await http("POST", "/api/auth/login", { json: { email: USERS.owner.email, password: PASSWORD } });
  step("1. вход паролем POST /api/auth/login", { status: login.status, setCookie: login.cookies });

  const sw = await http("POST", "/api/me/active-organization", { json: { organizationId: ORGS.master.id } });
  step("2. переход в мастер-кабинет", { status: sw.status, setCookie: sw.cookies });

  const master = await http("GET", "/master");
  step("3. GET /master", { status: master.status, location: master.location });

  // Старая кнопка «Выйти» мастер-кабинета: signOut({ callbackUrl: "/login" }) next-auth.
  const csrf = await http("GET", "/api/auth/csrf");
  const csrfToken = (JSON.parse(csrf.text) as { csrfToken: string }).csrfToken;
  const out = await http("POST", "/api/auth/signout", { form: { csrfToken, callbackUrl: "/login", json: "true" } });
  step("4. «Выйти» = signOut next-auth (POST /api/auth/signout)", { status: out.status, setCookie: out.cookies });

  const loginPage = await http("GET", "/login");
  step("5. GET /login", { status: loginPage.status, location: loginPage.location });
  let chain = loginPage.location;
  const hops: string[] = [];
  for (let i = 0; chain && i < 4; i += 1) {
    hops.push(chain);
    const next = await http("GET", chain);
    chain = next.location;
    if (!chain) hops.push(`${next.status}`);
  }
  step("6. куда уводит /login после «Выйти»", { hops });

  // Полный выход сайта: POST /api/auth/logout — что он гасит.
  const full = await http("POST", "/api/auth/logout");
  step("7. POST /api/auth/logout", { status: full.status, setCookie: full.cookies });

  const result = {
    phase: PHASE,
    base: BASE,
    loggedOutBySignOut: loginPage.status === 200,
    afterSignOutHops: hops,
    logoutClearsShellCookie: full.cookies.some((c) => c.startsWith("ws-shell")),
    steps,
  };
  fs.writeFileSync(path.join(OUT, "rootcause.json"), JSON.stringify(result, null, 2));
  console.log("RESULT", JSON.stringify({ loggedOutBySignOut: result.loggedOutBySignOut, hops, logoutClearsShellCookie: result.logoutClearsShellCookie }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
