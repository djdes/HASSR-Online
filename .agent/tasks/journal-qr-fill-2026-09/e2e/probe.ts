/* eslint-disable no-console */
// Состояние тестовой организации + токены QR-ссылок для проверок на dev.
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import { journalFillSubject } from "@/lib/journal-fill";

const ORG = "cmoe6rpt4000097ts71yb922y";
const OUT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/probe.json");

(async () => {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ORG },
    select: { qrFillMode: true, requireAdminForJournalEdit: true, timezone: true, disabledJournalCodes: true },
  });
  const users = await db.user.findMany({
    where: { organizationId: ORG, isActive: true },
    select: { id: true, name: true, role: true, email: true, qrPinHash: true },
    take: 20,
  });
  const docs: Record<string, { id: string; title: string } | null> = {};
  for (const code of ["hygiene", "finished_product", "cold_equipment_control", "cleaning", "health", "perishable_rejection", "climate"]) {
    docs[code] = await db.journalDocument.findFirst({
      where: { organizationId: ORG, status: "active", template: { code } },
      select: { id: true, title: true },
      orderBy: { dateFrom: "desc" },
    });
  }
  const fp = await db.journalDocument.findUnique({ where: { id: "cmt6j45tj0i0c82tstt9fjbvg" }, select: { config: true } });
  const rows = (((fp?.config as Record<string, unknown> | null)?.rows ?? []) as Array<Record<string, string>>).map((r) => ({ id: r.id, name: r.productName, temp: r.productTemp }));
  const suggestions = await db.nameSuggestion.findMany({ where: { organizationId: ORG }, select: { scope: true, value: true, meta: true }, orderBy: { lastUsedAt: "desc" }, take: 10 });
  const tokens = {
    hub: mintQrFillToken("journal", journalFillSubject(ORG, "all")),
    hygiene: mintQrFillToken("journal", journalFillSubject(ORG, "hygiene")),
    finished_product: mintQrFillToken("journal", journalFillSubject(ORG, "finished_product")),
    cold: mintQrFillToken("journal", journalFillSubject(ORG, "cold_equipment_control")),
    cleaning: mintQrFillToken("journal", journalFillSubject(ORG, "cleaning")),
    fpDoc: mintQrFillToken("journal", journalFillSubject(ORG, "finished_product", "cmt6j45tj0i0c82tstt9fjbvg")),
  };
  const out = { org, users: users.map((u) => ({ id: u.id, name: u.name, role: u.role, email: u.email, pin: Boolean(u.qrPinHash) })), docs, fpRows: rows, suggestions, tokens };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ org, users: out.users.length, docs, fpRows: rows.length, suggestions: suggestions.length }, null, 1));
  await db.$disconnect();
})();
