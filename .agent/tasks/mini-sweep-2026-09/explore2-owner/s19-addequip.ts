import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, s.base + "/settings/equipment", 7000);
  await page.getByRole("button", { name: "Добавить оборудование" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "19-add-sheet");
  console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
  console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")), null, 1));
  console.log("SHEET-TEXT", await page.evaluate(`document.body.innerText.slice(-1200)`));
  const geo = await page.evaluate(`(() => { const o=[...document.querySelectorAll('*')].filter(e=>{const cs=getComputedStyle(e); return cs.position==='fixed' && e.getBoundingClientRect().height>150;}).map(e=>{const r=e.getBoundingClientRect(); return e.tagName+'.'+String(e.className).slice(0,50)+' t='+Math.round(r.top)+' b='+Math.round(r.bottom)+' h='+Math.round(r.height);}); return {win:{w:innerWidth,h:innerHeight}, fixed:o}; })()`);
  console.log("GEO", JSON.stringify(geo, null, 1));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
