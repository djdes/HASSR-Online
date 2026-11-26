import { BASE, chromium, session, acceptLegal } from "/home/user/HASSR-Online/.agent/tasks/old-minor-fixes-2026-11-25/raw/verifier/stand/lib.mjs";
const OUT = process.argv[2];
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const page = await owner.newPage();
for (const width of [320, 360]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  for (const name of ["Кафе «Ромашка»", "Клиника на Садовой"]) {
    const h = page.locator("h2", { hasText: name }).first();
    await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await h.waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    const clip = async () => h.evaluate((el) => { const card = el.closest("[data-building-card]"); const r = card.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(window.innerWidth, r.width), height: Math.min(r.height, 260) }; });
    const slug = name.startsWith("Кафе") ? "romashka" : "sadovaya";
    await page.screenshot({ path: `${OUT}/ac8-real-${slug}-${width}-branch.png`, clip: await clip() });
    const style = await page.addStyleTag({ content: "[data-building-title]{display:contents !important}" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/ac8-real-${slug}-${width}-previous-simulated.png`, clip: await clip() });
    await style.evaluate((el) => el.remove());
  }
}
await browser.close();
