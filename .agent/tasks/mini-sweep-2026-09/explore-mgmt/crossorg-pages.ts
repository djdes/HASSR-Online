import { chromium } from "playwright";
import { state, db, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const T = `(function(){var h=document.querySelector("h1");return {url:location.pathname, h1:h?h.innerText.trim().slice(0,60):"", txt:(document.body?document.body.innerText:"").replace(/\s+/g," ").slice(0,220)};})()`;
async function main() {
  const eq = await db.equipment.findFirst({ where: { area: { organizationId: "e2e-org-a" } }, select: { id: true, name: true } });
  const batch = await db.batch.findFirst({ where: { organizationId: "e2e-org-a" }, select: { id: true } });
  const paths = [
    "/journals/hygiene/documents/cmu45uyxc004k5k9m0bq4vwux",
    "/journals/hygiene/documents/cmu45uyxc004k5k9m0bq4vwux/verify",
    "/journals/cleaning/documents/cmu7fcdzl000q9o9mdcyd87lp",
    `/settings/users/${(state as any).users.cookA.id}/access`,
    `/settings/users/${(state as any).users.cookA.id}`,
    `/settings/equipment/${eq?.id}`,
    `/batches/${batch?.id}`,
    "/mini/claim/" + ((await db.journalTaskClaim.findFirst({ where: { organizationId: "e2e-org-a" }, orderBy: { claimedAt: "desc" }, select: { id: true } }))?.id ?? "x"),
  ];
  console.log("eq", eq?.id, eq?.name, "batch", batch?.id);
  for (const role of ["managerB", "cookB"]) {
    const br = await chromium.launch({ headless: true });
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.request.post(BASE + "/api/auth/login", { data: { email: (state as any).users[role].email, password: (state as any).password } });
    const p = await ctx.newPage();
    for (const path of paths) {
      try {
        await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 300000 });
        await p.waitForTimeout(3500);
        let r: any; try { r = await p.evaluate(T); } catch { await p.waitForTimeout(3000); r = await p.evaluate(T); }
        console.log(`${role} ${path}\n   -> ${r.url} | H1=${r.h1} | ${r.txt.slice(0, 160)}`);
      } catch (e: any) { console.log(`${role} ${path} -> ERR ${String(e).slice(0, 100)}`); }
    }
    await br.close();
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
