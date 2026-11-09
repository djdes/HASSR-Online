import { login, sql, close } from "./lib.mjs";
const out = [];
const t = async (label, p) => { const r = await p; out.push(`${label} → ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`); return r; };
const maria = await login("maria");
const offerTask = sql(`select id from "CrmTask" where kind='offer' and status='open' and title like 'Скидка 20 %%' limit 1`);
out.push(`approved task payload: ${sql(`select "payloadJson"::text from "CrmTask" where id='${offerTask}'`).slice(0, 300)}`);
const cafeDeal = sql(`select id from "CrmDeal" where "organizationId"='fixture-cafe'`);
// use the approved ceiling (20 %) for a DIFFERENT deal of hers, with a bigger tariff
await t("approved task reused for another deal (fixture-cafe) at 20 %, vip 50 points", maria.api("POST", "/api/root/crm/offers", { dealId: cafeDeal, tier: "vip", cycle: "year", points: 50, discountPercent: 20, toEmail: "x@example.com", attachInvoice: false, taskId: offerTask }));
out.push(`task status: ${sql(`select status||'|'||coalesce(result,'')||'|'||coalesce("resultNote",'') from "CrmTask" where id='${offerTask}'`)}`);
out.push(`fixture-cafe codes: ${sql(`select string_agg(code||':'||value, ',') from "PromoCode" where "organizationId"='fixture-cafe'`)}`);
await t("send approved task again", maria.api("POST", "/api/root/crm/offers", { dealId: sql(`select id from "CrmDeal" where "organizationId"='lc-stolovaya'`), tier: "premium", cycle: "year", points: 3, discountPercent: 20, toEmail: "owner@lc-stolovaya.ru", taskId: offerTask }));
console.log(out.join("\n"));
await close();
