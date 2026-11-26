// Verifier AC8 detail: short name + short sphere label («Медицинские услуги») on phones — where does the chip go?
import fs from "node:fs";
import { BASE, chromium, session, acceptLegal } from "./lib.mjs";
const OUT = process.argv[2];
const NAME = "Кабинет 7";
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const res = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name: NAME, sphere: "medical" } });
const id = (await res.json()).building?.id;
const lines = [];
try {
  const page = await owner.newPage();
  for (const width of [320, 360, 390, 430, 639, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    const h = page.locator("h2", { hasText: NAME }).first();
    await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await h.waitFor({ state: "visible" });
    await page.waitForTimeout(400);
    const m = await h.evaluate((h2) => {
      const row = h2.closest("[data-building-title]").parentElement;
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
      return { name: r(h2), pin: r(row.querySelector("[data-pin-building]")), chip: r(row.querySelector("[data-building-sphere]")), chipText: row.querySelector("[data-building-sphere]").textContent };
    });
    const sameRow = Math.abs((m.chip.top + m.chip.bottom) / 2 - (m.name.top + m.name.bottom) / 2) < 16;
    lines.push(`${width}px «${m.chipText}»: chip ${sameRow ? `on the name row (left ${m.chip.left}, pin left ${m.pin.left})` : "below the name row"}`);
  }
} finally {
  if (id) await owner.request.delete(`${BASE}/api/settings/buildings/${id}`);
  console.log(lines.join("\n"));
  fs.writeFileSync(`${OUT}/ac8-short-sphere.txt`, lines.join("\n") + "\n");
  await browser.close();
}
