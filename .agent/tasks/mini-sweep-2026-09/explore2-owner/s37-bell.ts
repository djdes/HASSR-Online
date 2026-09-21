import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/dashboard", 9000);
    // колокольчик
    await page.evaluate(`[...document.querySelectorAll('header button')].slice(-1)[0].click()`);
    await page.waitForTimeout(3000);
    await shot(page, "37-bell");
    console.log("BELL", (await page.evaluate(`document.body.innerText`) as string).slice(-900));
    console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).slice(-12), null, 1));
    // переход
    await go(page, s.base + "/journals", 5000);
    await page.evaluate(`window.scrollBy(0, 600)`);
    await page.waitForTimeout(800);
    console.log("after nav: scrollY=", await page.evaluate(`window.scrollY`), "bodyOverflow=", await page.evaluate(`getComputedStyle(document.body).overflow`), "panelStill=", await page.evaluate(`!!document.querySelector('[data-notifications-panel],[class*="z-[70]"]')`));
    await shot(page, "37-after-nav");
    // подсветка нижнего меню
    for (const u of ["/settings", "/settings/users", "/reports", "/team", "/capa", "/journals", "/dashboard"]) {
      await go(page, s.base + u, 3000);
      const nav = await page.evaluate(`[...document.querySelectorAll('nav.mini-nav-rail a')].map(a=>a.innerText.trim()+(a.getAttribute('aria-current')?'*':'')+(getComputedStyle(a).backgroundColor!=='rgba(0, 0, 0, 0)'?'[BG]':''))`);
      console.log(u, "NAV", JSON.stringify(nav));
    }
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
