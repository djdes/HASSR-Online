import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  let newId = "";
  try {
    await go(page, `${s.base}/journals/cold_equipment_control`, 9000);
    await page.getByRole("button", { name: "Создать документ" }).click();
    await page.waitForTimeout(6000);
    await shot(page, "26-dlg");
    console.log("fields", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('input,select,textarea')].map(e=>e.tagName+':'+e.type+':'+(e.placeholder||''))`)));
    await page.locator("input[placeholder*='название документа']").fill("ZZ2 Холод новый документ");
    await page.locator("select").first().selectOption({ label: "Повар" });
    await page.waitForTimeout(500);
    const wait = page.waitForResponse((r:any)=>r.request().method()==="POST"&&r.url().includes("/api"), { timeout: 150000 }).catch(()=>null);
    console.log("btns", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('button')].map(b=>JSON.stringify(b.innerText)+(b.disabled?'[DISABLED]':'')).slice(-6)`)));
    await page.evaluate(`[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Создать').pop().click()`);
    await page.waitForTimeout(3000);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Всё равно создать'); if(b) b.click();}`);
    await page.waitForTimeout(1500);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Создать').pop(); if(b) b.click();}`);
    const rr = await wait;
    if (rr) { const b = await rr.text().catch(()=> ""); console.log("CREATE", rr.status(), rr.url().slice(-50), b.slice(0,250)); try { newId = JSON.parse(b).id ?? JSON.parse(b).document?.id ?? ""; } catch {} }
    await page.waitForTimeout(5000);
    console.log("URL-AFTER", page.url());
    await shot(page, "26-after-createdoc", true);
    console.log("TEXT", (await page.evaluate(`document.body.innerText`) as string).slice(0, 1500));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  const d = await db.journalDocument.findMany({ where: { title: { contains: "ZZ2" } }, select: { id:true,title:true,dateFrom:true,dateTo:true,autoFill:true,responsibleTitle:true, _count: { select: { entries: true } } } });
  console.log("DB-DOC", JSON.stringify(d, null, 1));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
