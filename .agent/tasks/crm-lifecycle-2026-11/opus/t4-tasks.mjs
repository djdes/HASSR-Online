import { login, sql, close } from "./lib.mjs";
const alexey = await login("alexey");
const out = [];
const t = async (label, p) => { const r = await p; out.push(`${label} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r; };
const openTask = (org, extra = "") => sql(`select id from "CrmTask" where "organizationId"='${org}' and status='open' ${extra} order by "createdAt" limit 1`);
const dealOf = (org) => sql(`select stage||'|'||"stageManual"||'|'||coalesce("lostReason",'')||'|'||coalesce("calledAt"::text,'-') from "CrmDeal" where "organizationId"='${org}'`);
// parallel double complete with follow-up
const paidTask = openTask("lc-paid");
const body = { result: "reached", note: "двойной клик", followUpAt: "2026-11-11T08:00:00.000Z" };
const [a, b] = await Promise.all([alexey.api("POST", `/api/root/crm/tasks/${paidTask}/complete`, body), alexey.api("POST", `/api/root/crm/tasks/${paidTask}/complete`, body)]);
out.push(`parallel complete: ${a.status} ${JSON.stringify(a.data)} / ${b.status} ${JSON.stringify(b.data)}`);
out.push(`lc-paid follow-ups: ${sql(`select count(*) from "CrmTask" where "organizationId"='lc-paid' and scenario='manual'`)}; timeline notes: ${sql(`select count(*) from "CrmInteraction" where "externalKey"='crm-task:${paidTask}'`)}; deal ${dealOf("lc-paid")}`);
// follow-up in the past
const fu = sql(`select id from "CrmTask" where "organizationId"='lc-paid' and scenario='manual' and status='open' limit 1`);
await t("complete follow-up with followUpAt in the past (2020)", alexey.api("POST", `/api/root/crm/tasks/${fu}/complete`, { result: "no_answer", followUpAt: "2020-01-01T08:00:00.000Z" }));
// postpone to past / invalid
const fu2 = sql(`select id from "CrmTask" where "organizationId"='lc-paid' and scenario='manual' and status='open' limit 1`);
await t("postpone to 2020", alexey.api("PATCH", `/api/root/crm/tasks/${fu2}`, { dueAt: "2020-01-01T08:00:00.000Z" }));
await t("postpone invalid", alexey.api("PATCH", `/api/root/crm/tasks/${fu2}`, { dueAt: "завтра" }));
await t("postpone empty body", alexey.api("PATCH", `/api/root/crm/tasks/${fu2}`, {}));
await t("reassign to nonexistent user", alexey.api("PATCH", `/api/root/crm/tasks/${fu2}`, { assigneeId: "nope" }));
await t("reassign to client user (no crm)", alexey.api("PATCH", `/api/root/crm/tasks/${fu2}`, { assigneeId: sql(`select id from "User" where email='owner@lc-paid.ru'`) }));
// each result on new manual tasks
const deal = sql(`select id from "CrmDeal" where "organizationId"='lc-month'`);
for (const result of ["no_answer", "messaged", "offer_sent", "promised", "done"]) {
  const created = await alexey.api("POST", "/api/root/crm/tasks", { dealId: deal, title: `Тест итога ${result}`, kind: "call", dueAt: "2026-11-10T08:00:00.000Z" });
  await t(`complete ${result}`, alexey.api("POST", `/api/root/crm/tasks/${created.data.id}/complete`, { result, note: `итог ${result}` }));
  out.push(`  deal lc-month: ${dealOf("lc-month")}`);
}
// declined on lc-solo
const soloTask = openTask("lc-solo");
await t("complete declined lc-solo", alexey.api("POST", `/api/root/crm/tasks/${soloTask}/complete`, { result: "declined", note: "Дорого", followUpAt: "2026-11-12T08:00:00.000Z" }));
out.push(`  deal lc-solo: ${dealOf("lc-solo")}; open tasks: ${sql(`select count(*) from "CrmTask" where "organizationId"='lc-solo' and status='open'`)}`);
// completing an already-closed task
await t("complete closed task again", alexey.api("POST", `/api/root/crm/tasks/${soloTask}/complete`, { result: "reached" }));
// invalid result
await t("complete invalid result", alexey.api("POST", `/api/root/crm/tasks/${openTask("lc-month")}/complete`, { result: "approved" }));
// manual task validation
await t("manual task title 2 chars", alexey.api("POST", "/api/root/crm/tasks", { title: "ab", dueAt: "2026-11-10T08:00:00.000Z" }));
await t("manual task no contact/deal", alexey.api("POST", "/api/root/crm/tasks", { title: "Без привязки", dueAt: "2026-11-10T08:00:00.000Z" }));
await t("manual task kind approval", alexey.api("POST", "/api/root/crm/tasks", { title: "Подделка", kind: "approval", dueAt: "2026-11-10T08:00:00.000Z" }));
await t("manual task bad deal", alexey.api("POST", "/api/root/crm/tasks", { dealId: "nope", title: "Плохая сделка", dueAt: "2026-11-10T08:00:00.000Z" }));
// mismatched deal + contact
await t("manual task deal lc-year + contact lc-month", alexey.api("POST", "/api/root/crm/tasks", { dealId: sql(`select id from "CrmDeal" where "organizationId"='lc-year'`), contactId: sql(`select "contactId" from "CrmDeal" where "organizationId"='lc-month'`), title: "Несовпадение", dueAt: "2026-11-10T08:00:00.000Z" }));
// deal patch validation
await t("deal bad stage", alexey.api("PATCH", `/api/root/crm/deals/${deal}`, { stage: "paid" }));
await t("deal patch nonexistent", alexey.api("PATCH", `/api/root/crm/deals/nope`, { stage: "won" }));
await t("deal empty patch", alexey.api("PATCH", `/api/root/crm/deals/${deal}`, {}));
console.log(out.join("\n"));
await close();
