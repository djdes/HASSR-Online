import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
const DOC = "cmu6pg3d50001309mb4xv4ipl";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control/documents/${DOC}`, 9000);
    await page.locator("button[aria-label='Что добавить'], button[title='Что добавить']").first().click().catch(async()=>{
      await page.evaluate(`[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.title)==='Что добавить').click()`);
    });
    await page.waitForTimeout(1200);
    await shot(page, "22-add-menu");
    console.log("MENU", await page.evaluate(`document.body.innerText.slice(-900)`));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
