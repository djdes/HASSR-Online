import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  let native = false;
  page.on("dialog", async d => { native = true; console.log("NATIVE", d.type(), JSON.stringify(d.message())); await d.dismiss(); });
  try {
    await go(page, s.base + "/dashboard", 9000);
    await page.getByRole("button", { name: "Закрыть день" }).click();
    await page.waitForTimeout(4000);
    await shot(page, "34-closeday");
    console.log("NATIVE?", native);
    console.log("DLG", (await page.evaluate(`document.body.innerText`) as string).slice(-1500));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).filter(x=>!x.includes("->/")).slice(-14), null, 1));
    const geo = await page.evaluate(`(() => { const e=[...document.querySelectorAll('*')].filter(x=>getComputedStyle(x).position==='fixed'&&x.getBoundingClientRect().height>60).map(x=>{const r=x.getBoundingClientRect(); return x.tagName+'.'+String(x.className).slice(0,50)+' t='+Math.round(r.top)+' b='+Math.round(r.bottom);}); return {h:innerHeight, e}; })()`);
    console.log("GEO", JSON.stringify(geo, null, 1));
    // закрыть и посмотреть «Выборочно»
    await page.keyboard.press("Escape"); await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Выборочно" }).click();
    await page.waitForTimeout(4000);
    await shot(page, "34-selective", true);
    console.log("SEL", (await page.evaluate(`document.body.innerText`) as string).slice(-1800));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
