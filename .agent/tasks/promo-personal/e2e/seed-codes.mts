// Коды e2e — той же функцией, что зовут рассылка и генератор КП (createPersonalPromoCodes), на
// живой локальной базе; заодно проверка promoLinkUrl / readPromoForOffer / suggestPersonalCode.
// Запуск из d:/wt/promo:  node --env-file=.env --import tsx .agent/tasks/promo-personal/e2e/seed-codes.mts
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.E2E_OUT || "d:/wt/tmp-promo";
const CREDS = path.join(OUT, "creds.json");
const BASE = process.env.E2E_BASE || "http://localhost:3191";

const { createPersonalPromoCodes, promoLinkUrl, readPromoForOffer, suggestPersonalCode } = await import(
  "file:///d:/wt/promo/src/lib/promo/personal-codes.ts"
);
const { db } = await import("file:///d:/wt/promo/src/lib/db.ts");

const creds = JSON.parse(fs.readFileSync(CREDS, "utf8"));
const endsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
const codes = await createPersonalPromoCodes(
  [
    { key: "guest1280", email: creds.guest1280, companyName: "Кафе «Ромашка»" },
    // То же название — проверка коллизии (суффикс «-2»).
    { key: "guest390", email: creds.guest390, companyName: "Ромашка" },
    { key: "owner", email: null, organizationId: creds.organizationId, companyName: "Кафе «Лавка»" },
  ],
  { kind: "percent", value: 10, lifetime: true, endsAt, note: "e2e КП", campaignId: "e2e-kp-2026-10" }
);
// Протухший код — для страницы «Промокод больше не действует».
await db.promoCode.deleteMany({ where: { code: "E2EOLD10" } });
await db.promoCode.create({
  data: { code: "E2EOLD10", kind: "percent", value: 10, endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), note: "e2e: истёк" },
});

const out: Record<string, unknown> = {};
for (const [key, value] of codes) {
  const offer = await readPromoForOffer(value.code);
  out[key] = { ...value, link: promoLinkUrl(value.code, { sphere: "cafe", baseUrl: BASE }), offer };
}
creds.codes = Object.fromEntries([...codes].map(([key, value]) => [key, value.code]));
creds.codeIds = Object.fromEntries([...codes].map(([key, value]) => [key, value.id]));
fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
const report = {
  created: out,
  expired: await readPromoForOffer("E2EOLD10"),
  unknown: await readPromoForOffer("NOSUCHCODE1"),
  suggest: {
    romashka: suggestPersonalCode("ООО «Ромашка»", 10),
    empty: suggestPersonalCode(null, 10),
  },
  prodLink: promoLinkUrl(creds.codes.guest1280, { sphere: "cafe" }),
};
fs.writeFileSync(path.join(OUT, "raw", "seed-codes.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await db.$disconnect?.();
process.exit(0);
