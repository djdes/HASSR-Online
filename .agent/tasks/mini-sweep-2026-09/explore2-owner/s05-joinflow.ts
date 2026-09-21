import { chromium } from "playwright";
import fs from "node:fs";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";
import { db } from "../tg-session";

const SHOTDIR = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-owner";
(async () => {
  const joinUrl = fs.readFileSync(SHOTDIR + "/joinurl.txt", "utf8").trim();
  console.log("JOIN", joinUrl);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push("pageerror " + String(e).slice(0, 150)));
  page.on("response", (r) => { if (r.status() >= 400 && !/_next\/static|favicon/.test(r.url())) errs.push(`http ${r.status()} ${r.request().method()} ${r.url().slice(-80)}`); });
  await go(page, joinUrl, 4000);
  await shot(page, "05-join-1", true);
  console.log("TEXT", await page.evaluate(`document.body.innerText.slice(0,2500)`));
  console.log("FIELDS", JSON.stringify(await page.evaluate(FIELDS), null, 1));
  console.log("CLICK", JSON.stringify((await page.evaluate(CLICKABLES) as string[]).slice(0, 25), null, 1));
  const pr = await probe(page);
  console.log("overflow", pr.overflow, "wide", JSON.stringify(pr.wide));
  console.log("ERRS", JSON.stringify(errs));
  await browser.close();
  await db.$disconnect();
})();
