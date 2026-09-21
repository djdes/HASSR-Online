import fs from "node:fs";
import path from "node:path";
import { openTelegramSession, db } from "../tg-session";
import { shot, go } from "./lib";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const DARK = fs.readFileSync(path.join(HERE, "dark-probe.js"), "utf8");
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: "dark" });
  const page = s.page;
  const check = async (tag: string) => console.log(tag, JSON.stringify(await page.evaluate(DARK), null, 1));
  const routes = ["/dashboard", "/journals", "/settings", "/settings/equipment", "/capa", "/reports", "/settings/appearance", "/mini/me"];
  for (const u of routes) {
    await go(page, s.base + u, 3500);
    await check("== " + u);
    await shot(page, "17-dark" + u.replace(/\//g, "_"), true);
  }
  await page.reload({ waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(3000);
  await check("== after-reload " + page.url());
  console.log("ERRORS", JSON.stringify(s.errors.slice(0, 10), null, 1));
  await s.close();
})();
