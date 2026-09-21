import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, s.base + "/settings/equipment", 7000);
  await shot(page, "18-equip", true);
  const pr = await probe(page);
  console.log("overflow", pr.overflow, "wide", JSON.stringify(pr.wide.slice(0,4)));
  console.log("TEXT", pr.bodyText.slice(0, 1800));
  console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).slice(0, 30), null, 1));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,6)));
  await s.close();
})();
