import { chromium, type APIRequestContext } from "playwright";
import { state, db, BASE } from "../tg-session";

type Probe = { m: string; url: string; body?: any };

async function login(role: string) {
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users[role].email, password: (state as any).password } });
  if (r.status() !== 200) console.log("!! login failed", role, r.status(), await r.text());
  return { br, ctx, req: ctx.request };
}

async function run(tag: string, req: APIRequestContext, probes: Probe[]) {
  for (const p of probes) {
    try {
      const res = p.m === "GET"
        ? await req.get(BASE + p.url, { failOnStatusCode: false })
        : await req.fetch(BASE + p.url, { method: p.m, data: p.body ?? {}, failOnStatusCode: false });
      const t = (await res.text()).replace(/\s+/g, " ").slice(0, 260);
      console.log(`${tag} ${p.m} ${p.url} -> ${res.status()} ${t}`);
    } catch (e: any) {
      console.log(`${tag} ${p.m} ${p.url} -> ERR ${String(e).slice(0, 120)}`);
    }
  }
}

async function main() {
  const docA = "cmu7fcdzl000q9o9mdcyd87lp"; // Журнал уборки, org A
  const docA2 = "cmu3xjc390004ks9mroi7qi9i";
  const uA = (state as any).users.cookA.id;
  const uHead = (state as any).users.headA.id;
  const claimA = (await db.journalTaskClaim.findFirst({ where: { organizationId: "e2e-org-a" }, orderBy: { claimedAt: "desc" }, select: { id: true } }))?.id ?? "none";
  console.log("claimA", claimA);

  const foreign: Probe[] = [
    { m: "GET", url: `/api/journal-documents/${docA}` },
    { m: "GET", url: `/api/journal-documents/${docA2}` },
    { m: "DELETE", url: `/api/journal-documents/${docA}` },
    { m: "GET", url: `/api/journals?code=hygiene` },
    { m: "GET", url: `/api/staff` },
    { m: "GET", url: `/api/audit` },
    { m: "GET", url: `/api/mini/today` },
    { m: "GET", url: `/api/journal-task-claims/my` },
    { m: "POST", url: `/api/journal-task-claims`, body: { journalCode: "cleaning", scopeKey: "probe:" + Date.now(), scopeLabel: "ПРОБА ЧУЖОГО", dateKey: "2026-09-20" } },
    { m: "POST", url: `/api/verifications/${claimA}`, body: { action: "approve" } },
    { m: "POST", url: `/api/control-board/remind`, body: { userIds: [uA], scopeLabel: "проба" } },
    { m: "GET", url: `/api/control-board` },
    { m: "GET", url: `/api/verifications` },
    { m: "GET", url: `/api/equipment` },
    { m: "GET", url: `/api/batches` },
    { m: "GET", url: `/api/reports` },
    { m: "GET", url: `/api/users/${uA}` },
    { m: "GET", url: `/api/staff/${uA}` },
    { m: "PATCH", url: `/api/staff/${uA}`, body: { role: "manager" } },
    { m: "PATCH", url: `/api/users/${uA}`, body: { role: "manager" } },
  ];

  for (const role of ["managerB", "cookB", "cookA"]) {
    const s = await login(role);
    await run(role, s.req, foreign);
    await s.br.close();
    console.log("---");
  }
  // без сессии
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext();
  await run("anon", ctx.request, foreign);
  await br.close();
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
