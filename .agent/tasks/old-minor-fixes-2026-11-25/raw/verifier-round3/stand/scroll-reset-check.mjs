import { BASE, chromium, devices, ownerState, acceptLegal } from "./lib3.mjs";
const browser = await chromium.launch();
const state = await ownerState(browser);
for (const name of ["Galaxy S24", "Galaxy S9+"]) {
  const { defaultBrowserType, ...d } = devices[name];
  const ctx = await browser.newContext({ ...d, storageState: state, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  const n = await page.locator("[data-building-card]").count();
  for (const idx of [5, n - 3]) {
    const loc = page.locator("[data-building-card]").nth(idx);
    const r = await loc.evaluate((el) => { el.querySelector("h2").scrollIntoView({ block: "center" }); return { sy: scrollY, top: el.querySelector("h2").getBoundingClientRect().top }; });
    const later = [];
    for (const t of [100, 500, 1500]) { await page.waitForTimeout(t); later.push(await loc.evaluate((el) => ({ sy: Math.round(scrollY), top: Math.round(el.querySelector("h2").getBoundingClientRect().top) }))); }
    console.log(name, "card", idx, "of", n, JSON.stringify(r), JSON.stringify(later));
  }
  await ctx.close();
}
await browser.close();
