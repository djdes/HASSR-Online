// Скоропорт по QR: «Несколько сразу» открывается, POST добавляет N позиций.
import fs from "node:fs";
import path from "node:path";
import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
const BASE = "http://localhost:3020";
const ORG = "e2e-org-a";
for (const line of fs.readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
(async () => {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const doc = await db.journalDocument.findFirst({ where: { organizationId: ORG, status: "active", template: { code: "perishable_rejection" }, dateFrom: { lte: today }, dateTo: { gte: today } }, select: { id: true, config: true } });
  if (!doc) { console.log("SKIP нет документа скоропорта"); process.exit(0); }
  const cook = await db.user.findFirstOrThrow({ where: { email: "cook-a@e2e.local" }, select: { id: true, qrPinHash: true } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { qrFillMode: true } });
  await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public" } });
  await db.user.update({ where: { id: cook.id }, data: { qrPinHash: null } });
  const token = mintQrFillToken("journal", `${ORG}:perishable_rejection:${doc.id}`);
  const url = `${BASE}/journal-fill/${ORG}/perishable_rejection?${new URLSearchParams({ token, employee: cook.id, bulk: "1" })}`;
  try {
    const get = await fetch(url);
    const html = await get.text();
    console.log(get.status === 200 && html.includes('id="f-productNames"') ? "PASS форма «Несколько сразу» скоропорта" : `FAIL get ${get.status}`);
    const form = new URLSearchParams({ action: "submit", productNames: "Молоко 3,2%\nСметана 20%", supplier: "ООО Молочник", quantity: "10 кг", arrivalTime: "09:30", organolepticResult: "good_quality", __openedAt: String(Date.now()) });
    const post = await fetch(url, { method: "POST", body: form, redirect: "manual" });
    const loc = post.headers.get("location") ?? "";
    const rows = ((await db.journalDocument.findUniqueOrThrow({ where: { id: doc.id }, select: { config: true } })).config as { rows: Array<{ productName: string; organolepticResult: string }> }).rows;
    const added = rows.filter((r) => ["Молоко 3,2%", "Сметана 20%"].includes(r.productName));
    console.log(post.status === 303 && loc.includes("n=2") && added.length === 2 && added.every((r) => r.organolepticResult === "good_quality") ? "PASS добавлено 2 позиции, оценка «Доброкачественная»" : `FAIL post ${post.status} ${loc} ${JSON.stringify(added)} ${post.status === 200 ? (await post.text()).match(/class="err"[^<]*>([^<]*)/)?.[1] : ""}`);
  } finally {
    await db.journalDocument.update({ where: { id: doc.id }, data: { config: doc.config as never } });
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: org.qrFillMode } });
    await db.user.update({ where: { id: cook.id }, data: { qrPinHash: cook.qrPinHash } });
    await db.$disconnect();
  }
})();
