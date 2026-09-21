import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES, FIELDS } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, `${s.base}/journals/cold_equipment_control`, 9000);
    await page.getByRole("button", { name: "Создать документ" }).click();
    await page.waitForTimeout(2500);
    await shot(page, "25-createdoc");
    console.log("DLG", (await page.evaluate(`document.body.innerText`) as string).slice(-1600));
    console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
    console.log("SELECTS", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('select')].map(s=>s.value+' :: '+[...s.options].map(o=>o.text).join(' / ').slice(0,300))`), null, 1));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(-16), null, 1));
    const geo = await page.evaluate(`(() => { const d=[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().height>150).map(e=>{const r=e.getBoundingClientRect(); return e.tagName+'.'+String(e.className).slice(0,60)+' t='+Math.round(r.top)+' b='+Math.round(r.bottom)+' sh='+e.scrollHeight+' ch='+e.clientHeight+' ovy='+getComputedStyle(e).overflowY;}); return {win:{w:innerWidth,h:innerHeight},d}; })()`);
    console.log("GEO", JSON.stringify(geo, null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
