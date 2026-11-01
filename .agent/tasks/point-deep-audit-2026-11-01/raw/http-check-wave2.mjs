// Отдельная копия e2e-базы (wesetup_ptinteg, dev на 3020), не прод.
// Сборка PR #99–#102: ссылка проверяющего на точку, партии и CAPA по точке,
// страницы принтера и Меркурия открываются.
// node .agent/tasks/point-deep-audit-2026-11-01/raw/http-check-wave2.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/point-deep-audit-2026-11-01/raw";
const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const base = process.env.BASE_URL ?? "http://localhost:3020";
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

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

async function req(method, path, cookie, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}
const withPoint = (cookie, pointId) => `${cookie}; wesetup.building=${fx.orgId}:${pointId}`;

const owner = await login(fx.owner);
const ownerOrg = withPoint(owner, "organization");
const ownerA = withPoint(owner, fx.pointA);
const ownerB = withPoint(owner, fx.pointB);

// 1. Страницы открываются.
for (const page of ["/batches", "/capa", "/capa/new", "/inspection", "/settings/inspector-portal", "/settings/print-agent", "/settings/integrations/mercury", "/reports", "/more"]) {
  const res = await req("GET", page, ownerOrg);
  check(`владелец: ${page} открывается`, res.status === 200, `HTTP ${res.status}`);
}
for (const api of ["/api/batches", "/api/capa", "/api/print/status", "/api/settings/inspector-tokens"]) {
  const res = await req("GET", api, ownerOrg);
  check(`владелец: ${api} отвечает`, res.status === 200, `HTTP ${res.status}`);
}

// 2. Ссылка проверяющего на точку А: видит документ А, не видит документ Б.
{
  const today = new Date().toISOString().slice(0, 10);
  const created = await req("POST", "/api/settings/inspector-tokens", ownerA, { label: "ПРОВЕРКА 01.11 точка А", periodFrom: "2026-10-01", periodTo: today, ttlHours: 24 });
  check("ссылка проверяющего на точку А выпущена", created.status === 200 && created.json?.token?.buildingId === fx.pointA, `HTTP ${created.status} ${JSON.stringify(created.json?.token?.buildingId ?? created.text.slice(0, 120))}`);
  const raw = created.json?.rawToken;
  if (raw) {
    const journal = await req("GET", `/inspector/${raw}/hygiene`, null);
    check("портал проверяющего (точка А): журнал гигиены открывается", journal.status === 200, `HTTP ${journal.status}`);
    check("портал проверяющего (точка А): нет документа точки Б", !journal.text.includes("гигиена точки Б"), "");
    const pdfB = await req("GET", `/api/inspector/${raw}/documents/${fx.hygieneDocB}/pdf`, null);
    check("портал проверяющего (точка А): PDF документа точки Б — не найден", pdfB.status === 404 || pdfB.status === 403, `HTTP ${pdfB.status}`);
  }
}
const headA = await login(fx.pointManagerA);
{
  const foreign = await req("POST", "/api/settings/inspector-tokens", headA, { label: "чужая", periodFrom: "2026-10-01", periodTo: "2026-11-01", buildingId: fx.pointB });
  check("руководитель точки А: ссылка проверяющего на точку Б — отказ", foreign.status === 403, `HTTP ${foreign.status}`);
  const orgWide = await req("POST", "/api/settings/inspector-tokens", headA, { label: "вся", periodFrom: "2026-10-01", periodTo: "2026-11-01", buildingId: null });
  check("руководитель точки А: ссылка на всю организацию — отказ", orgWide.status === 403, `HTTP ${orgWide.status}`);
  const own = await req("POST", "/api/settings/inspector-tokens", headA, { label: "своя", periodFrom: "2026-10-01", periodTo: "2026-11-01" });
  check("руководитель точки А: ссылка на свою точку — выдана", own.status === 200 && own.json?.token?.buildingId === fx.pointA, `HTTP ${own.status}`);
}

// 3. Партии и CAPA по точке.
{
  const batchB = await req("POST", "/api/batches", ownerB, { productName: "ПРОВЕРКА 01.11 партия точки Б", quantity: 5, unit: "kg" });
  const batchId = batchB.json?.id ?? batchB.json?.batch?.id;
  check("партия на точке Б создана с её точкой", batchB.status < 300 && (batchB.json?.buildingId ?? batchB.json?.batch?.buildingId) === fx.pointB, `HTTP ${batchB.status} ${batchB.text.slice(0, 160)}`);
  const capaB = await req("POST", "/api/capa", ownerB, { title: "ПРОВЕРКА 01.11 CAPA точки Б", priority: "medium", category: "other" });
  const capaId = capaB.json?.id ?? capaB.json?.ticket?.id;
  check("CAPA на точке Б создана с её точкой", capaB.status < 300 && (capaB.json?.buildingId ?? capaB.json?.ticket?.buildingId) === fx.pointB, `HTTP ${capaB.status} ${capaB.text.slice(0, 160)}`);
  if (batchId) {
    const seen = await req("GET", `/api/batches/${batchId}`, headA);
    check("руководитель точки А: партия точки Б — не найдена", seen.status === 404 || seen.status === 403, `HTTP ${seen.status}`);
    const list = await req("GET", "/api/batches", headA);
    check("руководитель точки А: в списке партий нет партии точки Б", !list.text.includes(batchId), `HTTP ${list.status}`);
  }
  if (capaId) {
    const patch = await req("PATCH", `/api/capa/${capaId}`, headA, { status: "closed" });
    check("руководитель точки А: закрыть CAPA точки Б — отказ", patch.status === 404 || patch.status === 403, `HTTP ${patch.status}`);
    const list = await req("GET", "/api/capa", ownerA);
    check("владелец смотрит точку А: CAPA точки Б в списке нет", !list.text.includes(capaId), `HTTP ${list.status}`);
    const listOrg = await req("GET", "/api/capa", ownerOrg);
    check("владелец «Вся организация»: CAPA точки Б в списке есть", listOrg.text.includes(capaId), `HTTP ${listOrg.status}`);
  }
}

const failed = out.filter((line) => line.startsWith("FAIL")).length;
out.push(failed ? `FAILED ${failed}/${out.length}` : `ALL PASS ${out.length}`);
console.log(out.at(-1));
writeFileSync(`${dir}/http-check-wave2.txt`, `${out.join("\n")}\n`);
