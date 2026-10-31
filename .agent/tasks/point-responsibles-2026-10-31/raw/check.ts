/**
 * e2e-БД (НЕ прод) и dev на 3023: ответственные за журналы по точкам.
 * DATABASE_URL=…/wesetup_e2e node --import tsx .agent/tasks/point-responsibles-2026-10-31/raw/check.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";

const DIR = ".agent/tasks/point-responsibles-2026-10-31/raw";
const BASE = "http://localhost:3023";
const MARK = "ПРОВЕРКА 01.11";
const PASSWORD = "Verify-2026!";
const out: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

async function login(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`вход не удался: ${email} (${res.status})`);
  return cookie();
}

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML */
  }
  return { status: res.status, json, text };
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const orgId: string = seed.orgId;
  await db.organization.update({ where: { id: orgId }, data: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const a = buildings.find((b) => b.name === "Точка А");
  const b = buildings.find((b) => b.name === "Точка Б");
  if (!a || !b) throw new Error("нет точек А/Б");
  const owner = await db.user.findFirstOrThrow({ where: { email: seed.manager }, select: { id: true, passwordHash: true } });
  await db.user.update({ where: { id: owner.id }, data: { lastActiveBuildingId: null } });

  // Прошлый прогон — убрать; ответственные точек и организации по гигиене — с нуля.
  await db.journalDocument.deleteMany({ where: { organizationId: orgId, title: { startsWith: MARK } } });
  await db.user.deleteMany({ where: { organizationId: orgId, email: { startsWith: "check-0111-" } } });
  await db.building.updateMany({ where: { organizationId: orgId }, data: { journalResponsibleUsersJson: null as never } });
  const mk = (key: string, name: string, role: string, buildingIds: string[]) =>
    db.user.create({
      data: { organizationId: orgId, email: `check-0111-${key}@verify.local`, name, role, passwordHash: owner.passwordHash, buildingIds },
      select: { id: true, email: true, name: true },
    });
  const anna = await mk("anna", `${MARK} Анна (точка А)`, "manager", [a.id]);
  const boris = await mk("boris", `${MARK} Борис (точка Б)`, "head_chef", [b.id]);
  const vera = await mk("vera", `${MARK} Вера (все точки)`, "head_chef", []);

  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "hygiene" }, select: { id: true } });
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mkDoc = (buildingId: string, key: string) =>
    db.journalDocument.create({
      data: { organizationId: orgId, templateId: template.id, buildingId, title: `${MARK} · гигиена точки ${key}`, status: "active", dateFrom: day, dateTo: day, responsibleUserId: owner.id },
      select: { id: true },
    });
  const docA = await mkDoc(a.id, "А");
  const docB = await mkDoc(b.id, "Б");
  const responsibleOf = async (id: string) => (await db.journalDocument.findUnique({ where: { id }, select: { responsibleUserId: true } }))?.responsibleUserId;

  const ownerCookie = await login(seed.manager);
  const annaCookie = await login(anna.email);

  // 1. Организация: Борис (точка Б) — ответственный гигиены.
  const orgSave = await call("PUT", "/api/settings/journal-responsibles/hygiene", ownerCookie, { positionIds: [], slotUsers: { main: boris.id }, scope: "active-any" });
  check("организация: сохранение 200", orgSave.status === 200, `${orgSave.status} ${orgSave.text.slice(0, 120)}`);
  check("организация: документ точки Б — Борис", (await responsibleOf(docB.id)) === boris.id);
  const aAfterOrg = await responsibleOf(docA.id);
  check("организация: в документ точки А Борис не попал (подобран человек точки)", Boolean(aAfterOrg) && aAfterOrg !== boris.id, `ответственный А: ${aAfterOrg}`);

  // 2. Заведующая точки А — свои ответственные точки.
  const page = await call("GET", "/settings/journal-responsibles", annaCookie);
  check("страница у заведующей точки А открывается", page.status === 200, String(page.status));
  check("страница: баннер точки А", page.text.includes("Ответственные точки «Точка А»"));
  // Список выбора — свойство `users` клиентского компонента (между `point` и
  // `journals`). Весь HTML не годится: dev-сервер кладёт в страницу отладочную
  // запись React с результатом запроса сотрудников (в прод-сборке её нет).
  const propsStart = page.text.indexOf('\\"point\\":{\\"id\\"');
  const propsEnd = page.text.indexOf('\\"journals\\":[', propsStart);
  const usersProp = propsStart >= 0 && propsEnd > propsStart ? page.text.slice(propsStart, propsEnd) : "";
  check("страница: в выборе есть сотрудница точки А", usersProp.includes(`${MARK} Анна`));
  check("страница: в выборе нет сотрудника точки Б", usersProp.length > 0 && !usersProp.includes(`${MARK} Борис`));
  const foreign = await call("PUT", "/api/settings/journal-responsibles/hygiene", annaCookie, { positionIds: [], slotUsers: { main: boris.id }, scope: "active-any", buildingId: a.id });
  check("точка А: сотрудника точки Б выбрать нельзя (400)", foreign.status === 400, `${foreign.status} ${String(foreign.json.error ?? "")}`);
  const pointSave = await call("PUT", "/api/settings/journal-responsibles/hygiene", annaCookie, { positionIds: [], slotUsers: { main: anna.id }, scope: "active-any", buildingId: a.id });
  check("точка А: сохранение 200", pointSave.status === 200, `${pointSave.status} ${pointSave.text.slice(0, 120)}`);
  check("точка А: документ точки А — Анна", (await responsibleOf(docA.id)) === anna.id);
  check("точка А: документ точки Б не тронут — Борис", (await responsibleOf(docB.id)) === boris.id);
  const buildingA = await db.building.findUnique({ where: { id: a.id }, select: { journalResponsibleUsersJson: true } });
  check("точка А: ответственные лежат в точке", JSON.stringify(buildingA?.journalResponsibleUsersJson ?? {}).includes(anna.id));
  const orgRow = await db.organization.findUnique({ where: { id: orgId }, select: { journalResponsibleUsersJson: true } });
  check("точка А: у организации по-прежнему Борис", JSON.stringify(orgRow?.journalResponsibleUsersJson ?? {}).includes(boris.id) && !JSON.stringify((orgRow?.journalResponsibleUsersJson as Record<string, unknown>)?.hygiene ?? {}).includes(anna.id));

  // 3. Новый документ точки А — её ответственный.
  const prefillA = await prefillResponsiblesForNewDocument({ organizationId: orgId, journalCode: "hygiene", baseConfig: {}, buildingId: a.id });
  check("новый документ точки А — Анна", prefillA.responsibleUserId === anna.id, String(prefillA.responsibleUserId));
  const prefillB = await prefillResponsiblesForNewDocument({ organizationId: orgId, journalCode: "hygiene", baseConfig: {}, buildingId: b.id });
  check("новый документ точки Б — Борис", prefillB.responsibleUserId === boris.id, String(prefillB.responsibleUserId));

  // 4. Организация меняет на Веру (все точки): точка А со своим — остаётся Анна.
  await call("PUT", "/api/settings/journal-responsibles/hygiene", ownerCookie, { positionIds: [], slotUsers: { main: vera.id }, scope: "active-any" });
  check("организация → Вера: точка Б — Вера", (await responsibleOf(docB.id)) === vera.id);
  check("организация → Вера: точка А со своими — Анна", (await responsibleOf(docA.id)) === anna.id);

  // 5. «Как у организации» на точке А.
  const reset = await call("DELETE", `/api/settings/journal-responsibles/hygiene?buildingId=${a.id}`, annaCookie);
  check("точка А: «Вернуть как у организации» 200", reset.status === 200, `${reset.status} ${reset.text.slice(0, 120)}`);
  check("точка А после возврата — Вера (организация, работает на всех точках)", (await responsibleOf(docA.id)) === vera.id);
  const buildingA2 = await db.building.findUnique({ where: { id: a.id }, select: { journalResponsibleUsersJson: true } });
  check("точка А после возврата: своих ответственных нет", !JSON.stringify(buildingA2?.journalResponsibleUsersJson ?? {}).includes("hygiene"));

  writeFileSync(`${DIR}/check.txt`, out.join("\n") + "\n");
  const failed = out.filter((line) => line.startsWith("FAIL")).length;
  console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
