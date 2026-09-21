import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
const DOC = "cmuaitnsh00vqcc9mjhcrizbn";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/equipment", 8000);
    // найдём строку ZZ2 и нажмём «изменить»
    const btns = await page.evaluate(`(() => { const out=[]; for (const tr of document.querySelectorAll('table tbody tr')) { if(!tr.innerText.includes('ZZ2')) continue; for (const b of tr.querySelectorAll('button')) out.push((b.getAttribute('aria-label')||b.title||b.innerText||'?')); } return out; })()`);
    console.log("ZZ2-ROW-BUTTONS", JSON.stringify(btns));
    await page.evaluate(`(() => { for (const tr of document.querySelectorAll('table tbody tr')) { if(!tr.innerText.includes('ZZ2')) continue; const bs=[...tr.querySelectorAll('button')]; bs[bs.length-2].click(); return; } })()`);
    await page.waitForTimeout(2500);
    await shot(page, "30-edit-sheet");
    console.log("SHEET", (await page.evaluate(`document.body.innerText`) as string).slice(-900));
    await page.locator("input[placeholder*='например 2']").fill("0");
    await page.locator("input[placeholder*='например 6']").fill("4");
    const wait = page.waitForResponse((r:any)=>/PATCH|PUT|POST/.test(r.request().method())&&r.url().includes("/api/equipment"), { timeout: 120000 }).catch(()=>null);
    await page.evaluate(`{const b=[...document.querySelectorAll('button')].filter(b=>/Сохранить|Создать/.test(b.innerText.trim())).pop(); b && b.click();}`);
    const rr = await wait; if (rr) console.log("SAVE", rr.status(), rr.request().method(), (await rr.text().catch(()=> "")).slice(0,150));
    await page.waitForTimeout(3000);
    console.log("DB-EQ", JSON.stringify(await db.equipment.findMany({ where: { name: { contains: "ZZ2" } }, select: { name:true,tempMin:true,tempMax:true } })));
    // теперь проверим подсказку в журнале
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 9000);
    const rows = await page.evaluate(`[...document.querySelectorAll("input[placeholder='—']")].map(i=>{let p=i;for(let k=0;k<6;k++)p=p.parentElement; return p.innerText.split(String.fromCharCode(10)).join(' | ').slice(0,80);})`);
    console.log("HINTS", JSON.stringify(rows, null, 1));
    console.log("NAMES", JSON.stringify(await page.evaluate(`(document.body.innerText.match(/ZZ2 Холодильник тест[\s\S]{0,80}/)||[''])[0]`)));
    await shot(page, "30-doc-after-norm", true);
  } catch (e) { console.log("ERR", String(e).slice(0,400)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
