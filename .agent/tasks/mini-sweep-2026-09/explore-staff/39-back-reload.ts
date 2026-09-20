import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  const st = async () => JSON.stringify({ url: p.url().replace(s.base, ""), back: await p.evaluate(`window.__tgHost.backVisible`), closed: await p.evaluate(`window.__tgHost.closed`) });
  console.log("start", await st());
  // client-side nav: today -> sections -> me
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(7000);
  console.log("today", await st());
  await p.locator('a[data-nav-href="/mini/sections"]').click(); await p.waitForTimeout(5000);
  console.log("sections", await st());
  await p.locator('a[data-nav-href="/mini/me"]').click(); await p.waitForTimeout(5000);
  console.log("me", await st());
  await s.pressTelegramBack(); await p.waitForTimeout(3000);
  console.log("after back 1", await st());
  await s.pressTelegramBack(); await p.waitForTimeout(3000);
  console.log("after back 2", await st());
  await s.pressTelegramBack(); await p.waitForTimeout(3000);
  console.log("after back 3 (home?)", await st());
  await s.pressTelegramBack(); await p.waitForTimeout(3000);
  console.log("after back 4", await st());
  // deep screen: claim page back
  const c = await db.journalTaskClaim.findFirst({ where: { organizationId: "e2e-org-a", status: "active" } });
  if (c) { await p.goto(s.base + "/mini/claim/" + c.id, { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(7000); console.log("claim", await st()); await s.pressTelegramBack(); await p.waitForTimeout(4000); console.log("claim back", await st()); }
  // reload on each type
  for (const u of ["/mini/today", "/mini/sections", "/mini/me", "/mini/outbox", "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i"]) {
    await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(6000);
    await p.reload({ waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(7000);
    const txt = ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ").slice(0, 110);
    console.log("reload", u, "->", p.url().replace(s.base, ""), "|", txt);
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
