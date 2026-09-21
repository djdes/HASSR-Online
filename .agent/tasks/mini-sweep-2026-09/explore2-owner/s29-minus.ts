import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const DOC = "cmuaitnsh00vqcc9mjhcrizbn";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 10000);
    const ins = page.locator("input[placeholder='—']");
    const labels = await page.evaluate(`[...document.querySelectorAll("input[placeholder='—']")].map(i=>{let p=i; for(let k=0;k<6;k++){p=p.parentElement;} return p.innerText.split(String.fromCharCode(10)).join(' | ').slice(0,90);})`);
    console.log("ROWS", JSON.stringify(labels, null, 1));
    const vals0 = await page.evaluate(`[...document.querySelectorAll("input[placeholder='—']")].map(i=>i.value)`);
    console.log("VALS0", JSON.stringify(vals0));
    // 4-я строка: Холодильник без журнала, норма 2..6, поле пустое
    const btns = await page.evaluate(`[...document.querySelectorAll("button[aria-label='Уменьшить']")].length`);
    console.log("minus buttons", btns);
    await page.evaluate(`[...document.querySelectorAll("button[aria-label='Уменьшить']")][3].click()`);
    await page.waitForTimeout(1500);
    console.log("ROW4 после одного «−» =", JSON.stringify(await ins.nth(3).inputValue()));
    await page.evaluate(`[...document.querySelectorAll("button[aria-label='Увеличить']")][2].click()`);
    await page.waitForTimeout(1500);
    console.log("ROW3 после одного «+» =", JSON.stringify(await ins.nth(2).inputValue()));
    await shot(page, "29-minus", true);
    await page.waitForTimeout(4000);
    const e = await db.journalDocumentEntry.findMany({ where: { documentId: DOC }, orderBy: { updatedAt: "desc" }, take: 2, select: { date:true, data:true } });
    console.log("DB", JSON.stringify(e.map(x=>({d:x.date.toISOString().slice(0,10), v:x.data})), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,400)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
