import { readFileSync } from "node:fs";
const fx = JSON.parse(readFileSync("D:/wt/pt-integ/.agent/tasks/point-deep-audit-2026-11-01/raw/fixture.json", "utf8"));
const base = "http://localhost:3020";
async function login(email) {
  const jar = new Map();
  const keep = (res) => { for (const raw of res.headers.getSetCookie?.() ?? []) { const [pair] = raw.split(";"); const at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const c = await fetch(`${base}/api/auth/csrf`); keep(c); const { csrfToken } = await c.json();
  const r = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() }, body: new URLSearchParams({ csrfToken, email, password: fx.password, json: "true" }) });
  keep(r); return cookie();
}
const cook = await login(fx.cookA);
for (const id of [fx.hygieneDocA, fx.hygieneDocB]) {
  const res = await fetch(`${base}/journals/hygiene/documents/${id}`, { headers: { cookie: cook }, redirect: "manual" });
  const html = await res.text();
  const markers = ["NEXT_HTTP_ERROR_FALLBACK;404", "не найден", "Не найдено", "Страница не найдена", "not-found"].filter((m) => html.includes(m));
  const occurrences = html.split(id).length - 1;
  console.log(id === fx.hygieneDocA ? "A(own)" : "B(foreign)", res.status, "len", html.length, "idCount", occurrences, "markers", JSON.stringify(markers));
}
import pg from "pg";
const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_ptinteg" });
await client.connect();
const doc = (await client.query('select title from "JournalDocument" where id=$1', [fx.hygieneDocB])).rows[0];
const staffB = (await client.query(`select name from "User" where "organizationId"=$1 and $2 = any("buildingIds") and "archivedAt" is null`, [fx.orgId, fx.pointB])).rows.map((r) => r.name);
await client.end();
const res = await fetch(`${base}/journals/hygiene/documents/${fx.hygieneDocB}`, { headers: { cookie: cook } });
const html = await res.text();
console.log("docB title:", doc.title, "→ in page:", html.includes(doc.title));
console.log("point B staff names in page:", staffB.filter((n) => html.includes(n)));
