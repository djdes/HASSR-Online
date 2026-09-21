import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES, dump } from "./lib";

(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  console.log("USER", JSON.stringify(s.user));
  console.log("URL", s.page.url());
  await shot(s.page, "01-start");
  const p = await probe(s.page);
  console.log("PROBE", JSON.stringify(p, null, 1).slice(0, 3000));
  // sections
  await go(s.page, s.base + "/mini/sections");
  await shot(s.page, "01-sections", true);
  const c = await s.page.evaluate(CLICKABLES);
  dump("01-sections-clickables", c);
  console.log("SECTIONS", JSON.stringify(c, null, 1).slice(0, 6000));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0, 20), null, 1));
  await s.close();
})();
