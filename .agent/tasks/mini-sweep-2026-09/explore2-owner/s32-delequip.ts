import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
const DOC = "cmuaitnsh00vqcc9mjhcrizbn";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  let native = false;
  page.on("dialog", async d => { native = true; console.log("NATIVE-DIALOG", d.type(), JSON.stringify(d.message())); await d.dismiss(); });
  try {
    await go(page, s.base + "/settings/equipment", 8000);
    await page.evaluate(`(() => { for (const tr of document.querySelectorAll('table tbody tr')) { if(!tr.innerText.includes('ZZ2')) continue; const bs=[...tr.querySelectorAll('button')]; bs[bs.length-1].click(); return; } })()`);
    await page.waitForTimeout(6000);
    await shot(page, "32-del-confirm", true);
    console.log("FIXED", JSON.stringify(await page.evaluate(`[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().height>60).map(e=>{const r=e.getBoundingClientRect(); return e.tagName+'.'+String(e.className).slice(0,60)+' t='+Math.round(r.top)+' l='+Math.round(r.left)+' w='+Math.round(r.width)+' h='+Math.round(r.height);})`), null, 1));
    console.log("NATIVE?", native);
    console.log("DLG", (await page.evaluate(`document.body.innerText`) as string).slice(-800));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(-10), null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
