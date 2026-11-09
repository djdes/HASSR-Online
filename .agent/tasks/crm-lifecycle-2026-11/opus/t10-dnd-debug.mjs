import { login, close, BASE, OUT } from "./lib.mjs";
const alexey = await login("alexey", { width: 2200, height: 1100 });
const p = alexey.page;
await p.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
// synthetic HTML5 DnD
await p.evaluate(() => {
  window.__events = [];
  const col = document.querySelector('[data-funnel-column="lost"]');
  for (const t of ["dragover", "drop", "dragleave"]) col.addEventListener(t, () => window.__events.push(t), true);
});
const dt = await p.evaluateHandle(() => new DataTransfer());
const card = p.locator('[data-funnel-card="Сеть «Вкусно рядом» e2e"]');
await card.dispatchEvent("dragstart", { dataTransfer: dt });
const col = p.locator('[data-funnel-column="lost"]');
await col.dispatchEvent("dragover", { dataTransfer: dt });
await col.dispatchEvent("drop", { dataTransfer: dt });
await card.dispatchEvent("dragend", { dataTransfer: dt });
await p.waitForTimeout(1000);
console.log("events", await p.evaluate(() => window.__events));
console.log("lost dialog after synthetic DnD:", await p.locator("[data-funnel-lost-reason]").count());
await p.screenshot({ path: `${OUT}/ui-06-dnd-lost-synthetic.png` });
if (await p.locator("[data-funnel-lost-reason]").count()) await p.keyboard.press("Escape");
// Now real mouse drag with page scrolled so the column middle is visible
await p.evaluate(() => window.scrollTo(0, 0));
const a = await card.boundingBox();
const b = await col.boundingBox();
await p.mouse.move(a.x + 30, a.y + 15);
await p.mouse.down();
await p.mouse.move(a.x + 60, a.y + 40, { steps: 5 });
await p.mouse.move(b.x + 100, Math.min(b.y + 200, 1000), { steps: 25 });
await p.mouse.up();
await p.waitForTimeout(1200);
console.log("lost dialog after real mouse DnD within viewport:", await p.locator("[data-funnel-lost-reason]").count());
await close();
