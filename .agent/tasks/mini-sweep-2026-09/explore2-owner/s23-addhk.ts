import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES, FIELDS } from "./lib";
const DOC = "cmu6pg3d50001309mb4xv4ipl";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 9000);
    await page.evaluate(`[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.title)==='Что добавить').click()`);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Добавить ХК" }).click();
    await page.waitForTimeout(2000);
    await shot(page, "23-addhk");
    console.log("DLG", await page.evaluate(`document.body.innerText.slice(-1400)`));
    console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(-20), null, 1));
    const opts = await page.evaluate(`[...document.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.text).join(' / '))`);
    console.log("SELECTS", JSON.stringify(opts, null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
