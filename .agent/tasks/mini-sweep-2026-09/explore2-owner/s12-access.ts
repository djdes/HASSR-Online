import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";
const UID = "cmuagc7we00q8cc9m9xkg98zx";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  await go(page, `${s.base}/settings/users/${UID}/access`, 7000);
  console.log("URL", page.url());
  await shot(page, "12-access", true);
  const pr = await probe(page);
  console.log("overflow", pr.overflow, "wide", JSON.stringify(pr.wide.slice(0,5)));
  console.log("TEXT", pr.bodyText.slice(0, 2200));
  const c: string[] = await page.evaluate(CLICKABLES);
  console.log("CLICK", JSON.stringify(c.slice(0, 40), null, 1));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})();
