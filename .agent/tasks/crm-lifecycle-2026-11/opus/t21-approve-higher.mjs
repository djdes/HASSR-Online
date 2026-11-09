import { login, sql, close } from "./lib.mjs";
const maria = await login("maria");
const alexey = await login("alexey");
const stol = sql(`select id from "CrmDeal" where "organizationId"='lc-stolovaya'`);
const req = await maria.api("POST", "/api/root/crm/offers", { dealId: stol, tier: "premium", cycle: "year", points: 3, discountPercent: 15, toEmail: "owner@lc-stolovaya.ru" });
console.log("request 15%:", JSON.stringify(req.data));
const a1 = await alexey.api("POST", `/api/root/crm/tasks/${req.data.taskId}/approval`, { approve: true, percent: 30 });
console.log("alexey approves 30 (> his 25):", a1.status, JSON.stringify(a1.data));
const a2 = await alexey.api("POST", `/api/root/crm/tasks/${req.data.taskId}/approval`, { approve: true, percent: 25 });
console.log("alexey approves 25 (> requested 15):", a2.status, JSON.stringify(a2.data));
console.log("offer task:", sql(`select title from "CrmTask" where id='${a2.data.offerTaskId}'`));
// approve on a lost deal: mark solo lost already; request from alexey for lc-solo 30% -> owner approval; check offer on lost deal
const solo = sql(`select id from "CrmDeal" where "organizationId"='lc-solo'`);
const s = await alexey.api("POST", "/api/root/crm/offers", { dealId: solo, tier: "standard", cycle: "year", points: 1, discountPercent: 5, toEmail: "owner@lc-solo.ru", attachInvoice: true });
console.log("offer on LOST deal (lc-solo):", s.status, JSON.stringify(s.data).slice(0, 200), "| deal:", sql(`select stage from "CrmDeal" where id='${solo}'`));
await close();
