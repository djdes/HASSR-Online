import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const DOC = "cmuaitnsh00vqcc9mjhcrizbn";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/equipment", 8000);
    await page.evaluate(`(() => { for (const tr of document.querySelectorAll('table tbody tr')) { if(!tr.innerText.includes('ZZ2')) continue; const bs=[...tr.querySelectorAll('button')]; bs[bs.length-1].click(); return; } })()`);
    await page.waitForTimeout(4000);
    const wait = page.waitForResponse((r:any)=>r.request().method()==="DELETE", { timeout: 120000 }).catch(()=>null);
    await page.getByRole("button", { name: "Да, удалить" }).click();
    const rr = await wait; if (rr) console.log("DELETE", rr.status(), (await rr.text().catch(()=> "")).slice(0,150));
    await page.waitForTimeout(3000);
    console.log("TOAST", await page.evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].map(e=>e.innerText).join(' // ')`));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("DB-EQ", JSON.stringify(await db.equipment.findMany({ where: { name: { contains: "ZZ2" } } })));
  const d = await db.journalDocument.findUnique({ where: { id: DOC }, select: { config: true } });
  console.log("DOC-CONFIG", JSON.stringify(d).slice(0, 900));
  const e2 = await db.journalDocumentEntry.findMany({ where: { documentId: DOC }, orderBy: { updatedAt: "desc" }, take: 1, select: { data: true } });
  console.log("ENTRY", JSON.stringify(e2));
  await s.close();
})();
