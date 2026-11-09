import { login, sql, close, sinkLines } from "./lib.mjs";
const alexey = await login("alexey");
const out = [];
const t = async (label, p) => { const r = await p; out.push(`${label} → ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`); return r; };
const deal = (org) => sql(`select id from "CrmDeal" where "organizationId"='${org}'`);
const sinkBefore = sinkLines().length;
// 1. Within limit, Romashka (INN), 10 %, two parallel requests (double click)
const rom = { dealId: deal("lc-romashka"), tier: "standard", cycle: "year", points: 2, discountPercent: 10, toEmail: "owner@lc-romashka.ru", attachInvoice: true };
const [r1, r2] = await Promise.all([alexey.api("POST", "/api/root/crm/offers", rom), alexey.api("POST", "/api/root/crm/offers", rom)]);
out.push(`parallel offer #1 → ${r1.status} ${JSON.stringify(r1.data)}`);
out.push(`parallel offer #2 → ${r2.status} ${JSON.stringify(r2.data)}`);
out.push(`romashka promo codes: ${sql(`select string_agg(code||':'||value||'%', ', ') from "PromoCode" where "organizationId"='lc-romashka'`)}`);
out.push(`romashka invoices: ${sql(`select string_agg(id||':'||"amountRub"||':'||status, ', ' order by id) from "PaymentOrder" where "organizationId"='lc-romashka' and "paymentMethod"='invoice'`)}`);
// 2. No INN (Pekarnya) with attachInvoice
await t("pekarnya (no INN) 5%", alexey.api("POST", "/api/root/crm/offers", { dealId: deal("lc-pekarnya"), tier: "standard", cycle: "year", points: 1, discountPercent: 5, toEmail: "owner@lc-pekarnya.ru", attachInvoice: true }));
// 3. Too few points: Stolovaya has 3 points in work → offer 1 point
await t("year (3 points) offer with 1 point 10%", alexey.api("POST", "/api/root/crm/offers", { dealId: deal("lc-year"), tier: "standard", cycle: "year", points: 1, discountPercent: 10, toEmail: "owner@lc-year.ru", attachInvoice: true }));
// 4. 0% with attachInvoice
await t("grace 0% offer", alexey.api("POST", "/api/root/crm/offers", { dealId: deal("lc-grace"), tier: "standard", cycle: "year", points: 1, discountPercent: 0, toEmail: "owner@lc-grace.ru", attachInvoice: true }));
// 5. 25% exactly at limit
await t("paid 25% (=limit)", alexey.api("POST", "/api/root/crm/offers", { dealId: deal("lc-paid"), tier: "premium", cycle: "month", points: 2, discountPercent: 25, toEmail: "owner@lc-paid.ru", attachInvoice: true, validDays: 60, lifetime: true, note: "<b>Привет</b> & \"кавычки\"" }));
// 6. Second offer to same deal again with different % (should old code be revoked?)
await t("romashka second offer 5%", alexey.api("POST", "/api/root/crm/offers", { ...rom, discountPercent: 5 }));
out.push(`romashka promo codes now: ${sql(`select string_agg(code||':'||value||'%:'||coalesce("endsAt"::text,'-'), ', ') from "PromoCode" where "organizationId"='lc-romashka'`)}`);
out.push(`romashka invoices now: ${sql(`select string_agg(id||':'||"amountRub"||':'||status, ', ' order by id) from "PaymentOrder" where "organizationId"='lc-romashka' and "paymentMethod"='invoice'`)}`);
out.push(`romashka deal: ${sql(`select stage||'|'||"amountRub"||'|'||coalesce("invoiceOrderId"::text,'-')||'|'||coalesce("offerJson"->'sent'->>'discountPercent','-') from "CrmDeal" where "organizationId"='lc-romashka'`)}`);
out.push("sink:\n  " + sinkLines().slice(sinkBefore).join("\n  "));
console.log(out.join("\n"));
await close();
