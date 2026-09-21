import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const DOC = "cmuaitnsh00vqcc9mjhcrizbn";
(async () => {
  console.log("DB-EQ", JSON.stringify(await db.equipment.findMany({ where: { name: { contains: "ZZ2" } }, select: { name:true,tempMin:true,tempMax:true } })));
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 10000);
    const rows = await page.evaluate(`[...document.querySelectorAll("input[placeholder='—']")].map(i=>{let p=i;for(let k=0;k<7;k++)p=p.parentElement; return p.innerText.split(String.fromCharCode(10)).join(' | ').slice(0,110);})`);
    console.log("ROWS", JSON.stringify(rows, null, 1));
    await shot(page, "31-hints", true);
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  await s.close();
})();
