import fs from "node:fs"; import path from "node:path";
import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const P = fs.readFileSync(path.join(HERE, "text-probe.js"), "utf8");
const ROUTES = process.argv.slice(2);
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  for (const u of ROUTES) {
    try {
      await go(page, s.base + u, 4000);
      const r: any = await page.evaluate(P);
      console.log("=====", u, "->", r.url);
      console.log("  h1:", r.h1, "| scrollW:", r.docScrollW);
      if (r.bad.length) console.log("  ENG:", JSON.stringify(r.bad, null, 1));
      if (r.wide.length) console.log("  WIDE:", JSON.stringify(r.wide, null, 1));
      if (r.small.length) console.log("  SMALL-FONT:", JSON.stringify(r.small));
      console.log("  TEXT:", r.text.replace(/\n/g, " | ").slice(0, 700));
      await shot(page, "35" + u.replace(/[\/?=&]/g, "_"), true);
    } catch (e) { console.log("=====", u, "ERR", String(e).slice(0, 200)); }
  }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0, 20), null, 1));
  await s.close();
})();
