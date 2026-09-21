import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  const now = await page.evaluate(`(() => ({ iso: new Date().toISOString(), loc: new Date().toString(), off: new Date().getTimezoneOffset() }))()`);
  console.log("BROWSER-NOW", JSON.stringify(now));
  console.log("NODE-NOW", new Date().toString(), "off", new Date().getTimezoneOffset());
  const pages = ["/mini/today", "/dashboard", "/reports", "/bonuses", "/plans", "/dashboard/catch-up", "/control-board"];
  for (const u of pages) {
    await go(page, s.base + u, 3500);
    const t = await page.evaluate(`document.body.innerText`);
    const dates = (t as string).match(/(понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)[^\n]{0,40}|\d{2}\.\d{2}\.\d{4}|20 сентября|21 сентября/gi) || [];
    console.log(u, "=>", JSON.stringify([...new Set(dates)].slice(0, 8)));
    const inputs = await page.evaluate(`[...document.querySelectorAll('input[type=date],input[type=month]')].map(i=>i.type+'='+i.value)`);
    if ((inputs as string[]).length) console.log("   date-inputs", JSON.stringify(inputs));
  }
  await s.close();
})();
