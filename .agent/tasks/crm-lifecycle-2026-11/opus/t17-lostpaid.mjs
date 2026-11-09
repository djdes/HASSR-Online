import { login, sql, close } from "./lib.mjs";
const alexey = await login("alexey");
const deal = sql(`select id from "CrmDeal" where "organizationId"='lc-paid' and kind='trial'`);
const r = await alexey.api("PATCH", `/api/root/crm/deals/${deal}`, { stage: "lost", lostReason: "Ушли к конкурентам" });
console.log("lost:", r.status, sql(`select stage||'|'||coalesce("lostReason",'') from "CrmDeal" where id='${deal}'`));
await close();
