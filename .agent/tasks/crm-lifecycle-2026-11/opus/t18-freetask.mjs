import { login, sql, close } from "./lib.mjs";
const alexey = await login("alexey");
const maria = await login("maria");
const task = sql(`select id from "CrmTask" where "organizationId"='lc-romashka' and status='open' and scenario='trial' limit 1`);
const dealId = sql(`select id from "CrmDeal" where "organizationId"='lc-romashka'`);
console.log("deal before:", sql(`select stage||'|owner='||"ownerId" from "CrmDeal" where id='${dealId}'`));
const u = await alexey.api("PATCH", `/api/root/crm/tasks/${task}`, { assigneeId: null });
console.log("alexey unassigns task:", u.status);
const m = await maria.api("POST", `/api/root/crm/tasks/${task}/complete`, { result: "declined", note: "Мария закрыла чужую сделку" });
console.log("maria completes free task on Alexey's deal with declined:", m.status, JSON.stringify(m.data));
console.log("deal after:", sql(`select stage||'|'||coalesce("lostReason",'')||'|owner='||"ownerId" from "CrmDeal" where id='${dealId}'`), "open tasks:", sql(`select count(*) from "CrmTask" where "dealId"='${dealId}' and status='open'`));
// restore
const back = await alexey.api("PATCH", `/api/root/crm/deals/${dealId}`, { stage: "message_sent" });
console.log("restore:", back.status);
await close();
