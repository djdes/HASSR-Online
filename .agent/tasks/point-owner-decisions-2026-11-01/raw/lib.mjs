// Помощники живой проверки решений владельца 2026-11-01 (локальная копия, НЕ прод).
// Фикстура и вход — из прошлой проверки изоляции (`point-isolation-audit-2026-11-01/raw`).
import { readFileSync, writeFileSync } from "node:fs";

export const dir = ".agent/tasks/point-owner-decisions-2026-11-01/raw";
export const fx = JSON.parse(readFileSync(".agent/tasks/point-isolation-audit-2026-11-01/raw/fixture.json", "utf8"));
export const base = process.env.BASE_URL ?? "http://localhost:3020";

const out = [];
export function check(name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
  return ok;
}
export function note(line) {
  out.push(`INFO ${line}`);
  console.log(`INFO ${line}`);
}
export function save(file) {
  const fails = out.filter((line) => line.startsWith("FAIL")).length;
  const passes = out.filter((line) => line.startsWith("PASS")).length;
  out.push(fails === 0 ? `ALL PASS ${passes}` : `FAILS ${fails} / PASS ${passes}`);
  writeFileSync(`${dir}/${file}`, `${out.join("\n")}\n`);
  console.log(out.at(-1));
}

// Вход ограничен 5 попытками на e-mail за 5 минут — сессии (JWT на год)
// переиспользуем между прогонами. Кэш — вне репозитория.
const SESSION_CACHE = process.env.SESSION_CACHE ?? "/tmp/claude-0/wesetup-points2-sessions.json";
function readSessions() {
  try {
    return JSON.parse(readFileSync(SESSION_CACHE, "utf8"));
  } catch {
    return {};
  }
}

export async function login(email) {
  const cached = readSessions()[`${base}|${email}`];
  if (cached) {
    const probe = await fetch(`${base}/api/auth/session`, { headers: { cookie: cached } });
    const session = await probe.json().catch(() => null);
    if (session?.user?.email === email) return cached;
  }
  const jar = new Map();
  const keep = (res) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: fx.password, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`вход не удался: ${email} (${res.status})`);
  const value = cookie();
  const sessions = readSessions();
  sessions[`${base}|${email}`] = value;
  writeFileSync(SESSION_CACHE, JSON.stringify(sessions));
  return value;
}

export async function req(method, path, cookie, body, { form } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { cookie: cookie ?? "", ...(body && !form ? { "content-type": "application/json" } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json, buffer, headers: res.headers };
}

/** Cookie выбора точки в шапке: `organization` — «Вся организация». */
export const withPoint = (cookie, pointId, orgId = fx.orgId) => `${cookie}; wesetup.building=${orgId}:${pointId}`;

/** Страница отдала «не найдено» (потоковая отдача оставляет 200). */
export const isNotFoundPage = (res) => res.status === 404 || res.text.includes("NEXT_HTTP_ERROR_FALLBACK;404");
