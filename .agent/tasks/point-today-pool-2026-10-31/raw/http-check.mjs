// e2e-база (dev на порту 3020), не прод: «Сегодня», «Проверка записей» и
// панель заведующей — только своя точка.
// node .agent/tasks/point-today-pool-2026-10-31/raw/http-check.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/point-today-pool-2026-10-31/raw";
const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const base = process.env.BASE_URL ?? "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

/** Вход по email/паролю через NextAuth; возвращает cookie-заголовок. */
async function login(email) {
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
  return cookie();
}

async function getJson(path, cookie) {
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const n = fx.names;

// 1. Повар точки А — «Сегодня».
{
  const cookie = await login(fx.cookA);
  const today = await getJson("/api/mini/today", cookie);
  const labels = today.groups.flatMap((g) => g.scopes.map((s) => s.scopeLabel)).join("\n");
  check("«Сегодня» повара А: свой холодильник есть", labels.includes(n.fridgeA));
  check("«Сегодня» повара А: холодильника точки Б нет", !labels.includes(n.fridgeB));
  check("«Сегодня» повара А: своя УФ-лампа есть", labels.includes(n.lampA));
  check("«Сегодня» повара А: УФ-лампы точки Б нет", !labels.includes(n.lampB));
  check("«Сегодня» повара А: склада точки Б нет (климат)", !labels.includes(n.roomB));
}

// 2. Повар точки Б — зеркально.
{
  const cookie = await login(fx.cookB);
  const today = await getJson("/api/mini/today", cookie);
  const labels = today.groups.flatMap((g) => g.scopes.map((s) => s.scopeLabel)).join("\n");
  check("«Сегодня» повара Б: свой холодильник есть", labels.includes(n.fridgeB));
  check("«Сегодня» повара Б: холодильника точки А нет", !labels.includes(n.fridgeA));
}

// 3. Заведующая точки А — «Проверка записей» и панель.
{
  const cookie = await login(fx.headA);
  const v = await getJson("/api/verifications", cookie);
  const pending = v.pendingReview.map((c) => c.executedBy).join("\n");
  check("«Проверка записей» точки А: работа повара А есть", pending.includes(n.cookA));
  check("«Проверка записей» точки А: работы повара Б нет", !pending.includes(n.cookB));
  const notTaken = v.notTaken.map((s) => s.scopeLabel).join("\n");
  check("«Проверка записей» точки А: в «не взято» нет холодильника точки Б", !notTaken.includes(n.fridgeB));
  const board = await getJson("/api/control-board", cookie);
  const people = board.subordinates.map((s) => s.name).join("\n");
  check("панель точки А: повар А в списке", people.includes(n.cookA));
  check("панель точки А: повара Б нет", !people.includes(n.cookB));
  const tasks = board.tasks.map((t) => t.scopeLabel).join("\n");
  check("панель точки А: холодильника точки Б нет", !tasks.includes(n.fridgeB));
}

// 4. Руководство на всю сеть («Вся организация») — видит обе точки, с подписью точки.
{
  const cookie = await login(fx.owner);
  const v = await getJson("/api/verifications", cookie);
  const pending = v.pendingReview.map((c) => c.executedBy).join("\n");
  check("«Вся организация»: работы обоих поваров на проверке", pending.includes(n.cookA) && pending.includes(n.cookB));
  const board = await getJson("/api/control-board", cookie);
  const rowsB = board.tasks.filter((t) => t.scopeLabel.includes(n.fridgeB));
  check("«Вся организация»: холодильник точки Б на панели с названием точки", rowsB.length > 0 && rowsB.every((t) => (t.sublabel ?? "").startsWith("Точка Б")), rowsB.map((t) => t.sublabel).join(" | "));
}

writeFileSync(`${dir}/http-check.txt`, out.join("\n") + "\n");
const failed = out.filter((line) => line.startsWith("FAIL")).length;
console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
process.exit(failed === 0 ? 0 : 1);
