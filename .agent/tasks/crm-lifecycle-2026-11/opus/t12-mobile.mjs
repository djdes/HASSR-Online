import { login, sql, close, errors, consoleErrors, OUT, BASE } from "./lib.mjs";
const note = (s) => console.log(s);
const owner = await login("owner", { width: 390, height: 844 });
const p = owner.page;
const contact = sql(`select "contactId" from "CrmDeal" where "organizationId"='lc-romashka'`);
const pages = ["/root/crm", "/root/crm/funnel", "/root/crm/tasks?who=all", "/root/crm/automation", `/root/crm/contacts/${contact}`, "/root/team"];
for (const path of pages) {
  const r = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // find elements wider than viewport (not inside horizontal scrollers)
  const wide = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const res = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        let s = el.parentElement, clipped = false;
        while (s) { const cs = getComputedStyle(s); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { clipped = true; break; } s = s.parentElement; }
        if (!clipped) res.push(`${el.tagName}.${(el.className?.baseVal ?? el.className ?? "").toString().slice(0, 60)} right=${Math.round(r.right)} text=${(el.textContent || "").trim().slice(0, 40)}`);
      }
    }
    return res.slice(0, 5);
  });
  const name = path.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "") || "root";
  await p.screenshot({ path: `${OUT}/m-${name.slice(0, 40)}.png`, fullPage: true });
  note(`${path} → ${r.status()} overflow ${ov}px ${wide.length ? "\n   " + wide.join("\n   ") : ""}`);
}
// open dialogs on phone: offer dialog and complete dialog
await p.goto(`${BASE}/root/crm/tasks?who=all`, { waitUntil: "networkidle" });
const firstOffer = p.locator("[data-crm-offer-open]").first();
if (await firstOffer.count()) {
  await firstOffer.click();
  await p.waitForSelector("[data-crm-offer-form]");
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const confirmVisible = await p.locator('[role="dialog"] button', { hasText: "Отправить" }).isVisible();
  note(`phone offer dialog overflow ${ov}px, confirm visible: ${confirmVisible}`);
  await p.screenshot({ path: `${OUT}/m-offer-dialog.png` });
  await p.keyboard.press("Escape");
}
await p.locator("[data-task-complete]").first().click();
await p.waitForSelector("[data-task-complete-form]");
note(`phone complete dialog overflow ${await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)}px`);
await p.screenshot({ path: `${OUT}/m-complete-dialog.png` });
note(`page errors: ${errors.length} ${errors.join(" | ")}`);
note(`console errors: ${consoleErrors.length} ${consoleErrors.slice(0, 5).join(" | ")}`);
await close();
