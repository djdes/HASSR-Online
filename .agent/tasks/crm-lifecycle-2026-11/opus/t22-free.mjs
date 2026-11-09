import { login, sql, close, BASE } from "./lib.mjs";
const alexey = await login("alexey");
const maria = await login("maria");
const stol = sql(`select id from "CrmDeal" where "organizationId"='lc-stolovaya'`);
const c = await alexey.api("POST", "/api/root/crm/tasks", { dealId: stol, title: "Свободная задача по Столовой", dueAt: "2026-11-09T12:00:00.000Z", assigneeId: null });
console.log("free task:", c.status, JSON.stringify(c.data));
for (const q of ["", "?who=none", "?who=all"]) {
  await maria.page.goto(`${BASE}/root/crm/tasks${q}`, { waitUntil: "networkidle" });
  console.log(`maria tasks${q}: sees free task = ${await maria.page.locator("[data-crm-task]", { hasText: "Свободная задача по Столовой" }).count()}`);
}
await maria.page.goto(`${BASE}/root/crm/contacts/${sql(`select "contactId" from "CrmDeal" where id='${stol}'`)}`, { waitUntil: "networkidle" });
console.log(`maria contact card: sees free task = ${await maria.page.locator("[data-crm-task]", { hasText: "Свободная задача по Столовой" }).count()}`);
await close();
