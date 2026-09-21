import { openTelegramSession, db } from "../tg-session";
import { shot, go, CLICKABLES } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/journals", 10000);
    await shot(page, "50-jset", true);
    const c = (await page.evaluate(CLICKABLES) as string[]);
    console.log("CLICK", JSON.stringify(c.slice(0, 45), null, 1));
    console.log("TEXT", (await page.evaluate(`document.body.innerText`) as string).slice(600, 2600));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  await s.close();
})();
