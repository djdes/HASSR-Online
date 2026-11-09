import { login, sql, close, errors, consoleErrors, OUT, BASE } from "./lib.mjs";
const out = [];
const note = (s) => { out.push(s); console.log(s); };
const alexey = await login("alexey");
const p = alexey.page;
// 1. Funnel DnD: «Сеть «Вкусно рядом» e2e» message_sent → called
await p.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/ui-01-funnel.png`, fullPage: true });
const card = p.locator('[data-funnel-card="Сеть «Вкусно рядом» e2e"]');
note(`year card column before: ${await card.evaluate((el) => el.closest("[data-funnel-column]").getAttribute("data-funnel-column"))}`);
await card.dragTo(p.locator('[data-funnel-column="called"]'));
await p.waitForTimeout(2500);
note(`after DnD db: ${sql(`select stage||'|'||"stageManual" from "CrmDeal" where "organizationId"='lc-year'`)}`);
// DnD to lost → dialog; type reason then cancel; then open lost on another card → reason prefilled?
await p.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
await p.locator('[data-funnel-card="Сеть «Вкусно рядом» e2e"]').dragTo(p.locator('[data-funnel-column="lost"]'));
await p.waitForSelector("[data-funnel-lost-reason]", { timeout: 5000 }).catch(() => null);
const dlg = await p.locator("[data-funnel-lost-reason]").count();
note(`lost dialog opened after DnD: ${dlg}`);
if (dlg) {
  await p.fill("[data-funnel-lost-reason]", "ПРИЧИНА ДЛЯ ВКУСНО РЯДОМ");
  await p.locator('[role="dialog"] button', { hasText: "Отмена" }).first().click().catch(async () => { await p.keyboard.press("Escape"); });
  await p.waitForTimeout(500);
  note(`dialog after cancel: ${await p.locator("[data-funnel-lost-reason]").count()}`);
  await p.locator('[data-funnel-card="Ресторан «Оплатили» e2e"] [data-funnel-move]').selectOption("lost");
  await p.waitForSelector("[data-funnel-lost-reason]");
  note(`lost dialog for another card prefilled with: "${await p.inputValue("[data-funnel-lost-reason]")}"`);
  await p.screenshot({ path: `${OUT}/ui-02-lost-prefilled.png` });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  note(`paid card select value after cancel: ${await p.locator('[data-funnel-card="Ресторан «Оплатили» e2e"] [data-funnel-move]').inputValue()}`);
}
// filters
for (const q of ["?kind=trial", "?kind=renewal", "?closing=7", "?owner=none", "?owner=me", "?kind=bogus", "?owner=bogus"]) {
  const r = await p.goto(`${BASE}/root/crm/funnel${q}`, { waitUntil: "networkidle" });
  note(`funnel${q} → ${r.status()} cards ${await p.locator("[data-funnel-card]").count()}`);
}
// tasks filters
for (const q of ["", "?who=all", "?who=none", "?kind=call", "?kind=approval", "?kind=offer", "?kind=invoice", "?who=all&kind=bogus"]) {
  const r = await p.goto(`${BASE}/root/crm/tasks${q}`, { waitUntil: "networkidle" });
  note(`tasks${q} → ${r.status()} tasks ${await p.locator("[data-crm-task]").count()}`);
}
await p.goto(`${BASE}/root/crm/tasks?who=all`, { waitUntil: "networkidle" });
await p.screenshot({ path: `${OUT}/ui-03-tasks-all.png`, fullPage: true });
// Maria: contact card of a free contact with Alexey's deal
const maria = await login("maria");
const romContact = sql(`select "contactId" from "CrmDeal" where "organizationId"='lc-romashka'`);
const r = await maria.page.goto(`${BASE}/root/crm/contacts/${romContact}`, { waitUntil: "networkidle" });
const panel = (await maria.page.locator("[data-crm-pipeline]").innerText().catch(() => "")).replace(/\s+/g, " ");
note(`maria Romashka contact → ${r.status()}; panel: ${panel.slice(0, 400)}`);
await maria.page.screenshot({ path: `${OUT}/ui-04-maria-foreign-deal.png`, fullPage: true });
const r2 = await maria.page.goto(`${BASE}/root/crm/tasks?who=none`, { waitUntil: "networkidle" });
note(`maria tasks?who=none → ${r2.status()} tasks ${await maria.page.locator("[data-crm-task]").count()}`);
for (const q of ["?owner=all", `?owner=${sql(`select id from "User" where email='alexey@wesetup.ru'`)}`]) {
  await maria.page.goto(`${BASE}/root/crm/funnel${q}`, { waitUntil: "networkidle" });
  note(`maria funnel${q}: ${(await maria.page.locator("[data-funnel-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-funnel-card")))).join(", ")}`);
}
note(`page errors: ${errors.length}\n  ${errors.join("\n  ")}`);
note(`console errors: ${consoleErrors.length}\n  ${consoleErrors.slice(0, 10).join("\n  ")}`);
await close();
