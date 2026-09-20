import { chromium } from "playwright";
import fs from "node:fs"; import path from "node:path";
const BASE = "http://localhost:3021";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-staff/";
const HOST = fs.readFileSync(path.join("D:/www/Wesetup.ru/.agent/tasks/mini-sweep-2026-09", "tg-host.js"), "utf8");
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(HOST);
  const p = await ctx.newPage();
  for (const u of ["/mini/today", "/journals/hygiene", "/mini/me", "/mini/claim/xyz"]) {
    const r = await p.goto(BASE + u, { waitUntil: "load", timeout: 300000 });
    await p.waitForTimeout(20000);
    const t = ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ").slice(0, 300);
    console.log(u, "->", r?.status(), p.url().replace(BASE, ""), "|", t);
    await p.screenshot({ path: SHOT + "noauth-" + u.replace(/\W+/g, "_") + ".png" });
  }
  await b.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
