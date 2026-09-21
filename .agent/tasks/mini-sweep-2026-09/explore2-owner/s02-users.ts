import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS, dump } from "./lib";

(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, s.base + "/settings/users", 4000);
  await shot(page, "02-users", true);
  const p = await probe(page);
  console.log("URL", p.url, "overflow", p.overflow, "wide", JSON.stringify(p.wide));
  console.log("TEXT", p.bodyText.slice(0, 2500));
  const c: string[] = await page.evaluate(CLICKABLES);
  console.log("CLICK", JSON.stringify(c, null, 1).slice(0, 5000));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0, 15)));
  await s.close();
})();
