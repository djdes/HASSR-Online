import { BASE, chromium, devices, ownerState, acceptLegal } from "./lib3.mjs";
const browser = await chromium.launch();
const state = await ownerState(browser);
const { defaultBrowserType, ...d } = devices["iPhone SE landscape"];
const ctx = await browser.newContext({ ...d, storageState: state, locale: "ru-RU" });
const page = await ctx.newPage();
await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
await acceptLegal(page);
await page.waitForTimeout(2500);
// (relative import of lib3.mjs; run from this directory)
const loc = page.locator("[data-building-card]").nth(3);
await loc.evaluate((el) => el.querySelector("h2").scrollIntoView({ block: "center" }));
await page.waitForTimeout(500);
console.log(JSON.stringify(await loc.evaluate((card) => {
  const pin = [...card.querySelectorAll("[data-pin-building]")].find((p) => getComputedStyle(p).display !== "none");
  const r = pin.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const desc = (el) => el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className?.baseVal ?? el.className).slice(0, 60)} pos=${getComputedStyle(el).position}` : "null";
  const out = { pin: [r.left, r.top, r.width, r.height], vh: innerHeight, sy: scrollY };
  for (const [dx, dy] of [[0, 0], [0, 20], [0, 23], [0, 23.5], [-23.5, 23.5], [23.5, 23.5], [0, -23.5]]) {
    const stack = document.elementsFromPoint(cx + dx, cy + dy).slice(0, 4).map(desc);
    out[`${dx},${dy}`] = stack;
  }
  return out;
}), null, 1));
await page.screenshot({ path: "landscape-chrome-check.png" });
await browser.close();
