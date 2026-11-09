import { login, sql, close, BASE } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const owner = await login("owner");
const p = owner.page;
let dump = "";
for (const path of ["/root/crm", "/root/crm/automation", "/root/crm/tasks?who=all", `/root/crm/contacts/${sql(`select "contactId" from "CrmDeal" where "organizationId"='lc-stolovaya'`)}`]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const text = await p.locator("main").innerText().catch(async () => p.locator("body").innerText());
  dump += `\n\n===== ${path}\n${text}`;
}
writeFileSync(".agent/tasks/crm-lifecycle-2026-11/opus/pages-text.txt", dump);
await close();
