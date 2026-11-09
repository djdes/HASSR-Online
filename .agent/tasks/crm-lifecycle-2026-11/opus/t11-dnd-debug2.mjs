import { login, close, BASE, sql } from "./lib.mjs";
const alexey = await login("alexey", { width: 2200, height: 1100 });
const p = alexey.page;
await p.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
await p.evaluate(() => {
  window.__ev = [];
  for (const t of ["dragstart", "drop", "dragend", "click", "mouseup"]) window.addEventListener(t, (e) => window.__ev.push(`${t}:${e.target?.getAttribute?.("data-funnel-column") ?? e.target?.tagName}`), true);
  const obs = new MutationObserver(() => { if (document.querySelector("[data-funnel-lost-reason]")) window.__ev.push("DIALOG-SHOWN"); });
  obs.observe(document.body, { childList: true, subtree: true });
});
await p.locator('[data-funnel-card="Ресторан «Оплатили» e2e"]').dragTo(p.locator('[data-funnel-column="lost"] header'));
await p.waitForTimeout(1500);
console.log("to lost header:", await p.evaluate(() => window.__ev), "dialog now:", await p.locator("[data-funnel-lost-reason]").count());
await close();
