import { chromium } from "playwright";
import { db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";

(async () => {
  const pos = await db.jobPosition.findMany({ where: { organizationId: "e2e-org-a" }, select: { id:true, name:true, _count: { select: { journalAccess: true } } } });
  console.log("POSITIONS-JOURNAL-ACCESS", JSON.stringify(pos, null, 1));
  const cook = await db.user.findFirst({ where: { email: "cook-a@e2e.local" }, select: { id: true, journalAccessMigrated: true } });
  console.log("cookA acl rows", await db.userJournalAccess.count({ where: { userId: cook!.id } }), JSON.stringify(cook));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("response", (r) => { if (r.status() >= 400 && !/_next\/static|favicon/.test(r.url())) errs.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(-70)}`); });
  await go(page, "http://localhost:3021/login", 4000);
  await shot(page, "08-login", true);
  console.log("LOGIN-FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
  console.log("LOGIN-CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).slice(0,20), null, 1));
  console.log("LOGIN-TEXT", await page.evaluate(`document.body.innerText.slice(0,1200)`));
  await browser.close();
  await db.$disconnect();
})();
