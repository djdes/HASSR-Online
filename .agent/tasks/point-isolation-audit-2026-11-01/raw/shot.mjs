// Снимок страницы глазами человека (локальная wesetup_iso, dev на 3020 — не прод).
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/shot.mjs <email> <point|-> <url> <file.png> [текст для подсветки]
import { chromium } from "playwright";

import { base, dir, fx, login } from "./http-lib.mjs";

const [email, point, url, file, highlight] = process.argv.slice(2);
const cookieHeader = await login(email);
const cookies = cookieHeader.split("; ").map((pair) => {
  const at = pair.indexOf("=");
  return { name: pair.slice(0, at), value: pair.slice(at + 1), url: base };
});
if (point && point !== "-") {
  cookies.push({ name: "wesetup.building", value: `${fx.orgId}:${point}`, url: base });
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
await context.addCookies(cookies);
const page = await context.newPage();
await page.goto(`${base}${url}`, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);
if (highlight) {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue?.includes(needle)) hits.push(walker.currentNode.parentElement);
    for (const el of hits) {
      el.style.outline = "3px solid red";
      el.style.background = "rgba(255,0,0,0.12)";
    }
    hits[0]?.scrollIntoView({ block: "center" });
  }, highlight);
  await page.waitForTimeout(300);
}
const visible = highlight ? await page.getByText(highlight, { exact: false }).count() : null;
await page.screenshot({ path: `${dir}/${file}`, fullPage: false });
console.log(JSON.stringify({ url, file, visibleMatches: visible }));
await browser.close();
