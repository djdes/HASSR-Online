import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/dashboard", 8000);
    await page.getByRole("button", { name: "ИИ-помощник" }).click();
    await page.waitForTimeout(5000);
    await shot(page, "43-ai");
    console.log("TAIL", (await page.evaluate(`document.body.innerText`) as string).slice(-600));
    const r = await page.evaluate(`(() => { const ov=[...document.querySelectorAll('div,section,aside')].filter(d=>/fixed/.test(String(d.className))&&d.getBoundingClientRect().height>200); return ov.slice(0,6).map(d=>{const rr=d.getBoundingClientRect(); return String(d.className).slice(0,60)+' z='+getComputedStyle(d).zIndex+' '+Math.round(rr.width)+'x'+Math.round(rr.height)+' @'+Math.round(rr.top)+' parent='+d.parentElement.tagName+'.'+String(d.parentElement.className).slice(0,30);}); })()`);
    console.log("FIXED", JSON.stringify(r, null, 1));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
