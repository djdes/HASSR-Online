import { login, sql, close } from "./lib.mjs";
const maria = await login("maria");
const out = [];
const t = async (label, p) => { const r = await p; out.push(`${label} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r; };
const stolDeal = sql(`select id from "CrmDeal" where "organizationId"='lc-stolovaya'`);
const romDeal = sql(`select id from "CrmDeal" where "organizationId"='lc-romashka'`);
const base = { dealId: stolDeal, tier: "premium", cycle: "year", points: 3, toEmail: "owner@lc-stolovaya.ru", attachInvoice: true };
const a = await t("maria offer 25% (needs approval)", maria.api("POST", "/api/root/crm/offers", { ...base, discountPercent: 25 }));
const approvalId = a.data.taskId;
out.push(`approval task: ${sql(`select "assigneeId"||'|'||title from "CrmTask" where id='${approvalId}'`)}`);
// Maria tries to decide her own request
await t("maria approve own request at 25", maria.api("POST", `/api/root/crm/tasks/${approvalId}/approval`, { approve: true, percent: 25 }));
await t("maria reject (percent omitted)", maria.api("POST", `/api/root/crm/tasks/${approvalId}/approval`, { approve: false }));
await t("maria reject with percent:1", maria.api("POST", `/api/root/crm/tasks/${approvalId}/approval`, { approve: false, percent: 1, comment: "сам себе отказал" }));
out.push(`approval after: ${sql(`select status||'|'||coalesce(result,'')||'|'||coalesce("completedById",'') from "CrmTask" where id='${approvalId}'`)}`);
// second approval request, try approve at 5 %
const b = await t("maria offer 30% (needs approval)", maria.api("POST", "/api/root/crm/offers", { ...base, discountPercent: 30 }));
const approval2 = b.data.taskId;
out.push(`approval2: ${sql(`select coalesce("assigneeId",'-')||'|'||title from "CrmTask" where id='${approval2}'`)}`);
await t("maria approve own 30% request at 5%", maria.api("POST", `/api/root/crm/tasks/${approval2}/approval`, { approve: true, percent: 5 }));
out.push(`approval2 after: ${sql(`select status||'|'||coalesce(result,'')||'|'||coalesce("resultNote",'') from "CrmTask" where id='${approval2}'`)}`);
out.push(`offer tasks: ${sql(`select kind||'|'||status||'|'||title from "CrmTask" where "organizationId"='lc-stolovaya' and kind='offer'`)}`);
// approval for a foreign deal requested by Alexey? create via alexey with 30% (above his 25)
const alexey = await login("alexey");
const c = await t("alexey offer 30% on Romashka (> his 25)", alexey.api("POST", "/api/root/crm/offers", { dealId: romDeal, tier: "standard", cycle: "year", points: 2, discountPercent: 30, toEmail: "owner@lc-romashka.ru" }));
if (c.data?.taskId) {
  out.push(`alexey approval: ${sql(`select coalesce("assigneeId",'-')||'|'||title from "CrmTask" where id='${c.data.taskId}'`)}`);
  await t("maria rejects Alexey's foreign approval (percent:1)", maria.api("POST", `/api/root/crm/tasks/${c.data.taskId}/approval`, { approve: false, percent: 1, comment: "чужое" }));
  out.push(`after: ${sql(`select status||'|'||coalesce(result,'')||'|'||coalesce("completedById",'') from "CrmTask" where id='${c.data.taskId}'`)}`);
}
console.log(out.join("\n"));
await close();
