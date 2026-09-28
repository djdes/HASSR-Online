/**
 * Данные для e2e doc-mobile-scroll-2026-09 на своей базе (wesetup_wt_docscroll).
 *
 * Организация «Кафе «Ромашка»» (ресторан, все журналы включены) с руководителем
 * и заселением демо-генератора (`seedDemoOrganizationData`): команда, помещения,
 * холодильники, документы всех журналов пресета с записями за сентябрь. Журналы
 * с экраном документа, которых нет в пресете, получают по пустому активному
 * документу через тот же `ensureActiveDocument`, что и ночной cron.
 *
 * Запуск (из C:/wt/docscroll, dev-сервер НЕ нужен):
 *   node --import tsx .agent/tasks/doc-mobile-scroll-2026-09/e2e/seed.ts
 * Пишет creds.json в E2E_OUT (по умолчанию D:/wt-build/tmp-docscroll) — вне git.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { seedDemoOrganizationData } from "@/lib/demo-organization";
import { ensureActiveDocument } from "@/lib/journal-auto-create";
import { hasDocumentFillUi } from "@/lib/journal-document-helpers";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wesetup_wt_docscroll")) throw new Error("Только своя база wesetup_wt_docscroll");

const OUT = process.env.E2E_OUT || "D:/wt-build/tmp-docscroll";
const LEGAL_VERSION = /LEGAL_VERSION = "([^"]+)"/.exec(
  readFileSync("src/lib/legal-consent.ts", "utf8"),
)?.[1];
if (!LEGAL_VERSION) throw new Error("LEGAL_VERSION не найден");

const PASSWORD = "DocScroll-2026!";
const stamp = Date.now().toString(36);

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const managerEmail = `docscroll.manager.${stamp}@example.com`;

  const organization = await db.organization.create({
    data: {
      name: "Кафе «Ромашка»",
      type: "restaurant",
      disabledJournalCodes: [],
      subscriptionPlan: "free",
    },
    select: { id: true },
  });
  const manager = await db.user.create({
    data: {
      email: managerEmail,
      name: "Анна Смирнова",
      phone: `+7997${Date.now().toString().slice(-7)}`,
      passwordHash,
      role: "manager",
      organizationId: organization.id,
      journalAccessMigrated: true,
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
    },
    select: { id: true },
  });
  const account = await db.account.create({
    data: { ownerUserId: manager.id, subscriptionPlan: "free" },
    select: { id: true },
  });
  await db.organization.update({
    where: { id: organization.id },
    data: { accountId: account.id },
  });
  await db.organizationMember.create({
    data: { userId: manager.id, organizationId: organization.id, role: "owner" },
  });

  const seed = await seedDemoOrganizationData({
    organizationId: organization.id,
    sphere: "restaurant",
    createdById: manager.id,
    extraEmployees: [{ id: manager.id, name: "Анна Смирнова" }],
    daysOfHistory: 28,
  });
  console.log("demo seed", seed);

  // Журналы с экраном документа вне пресета — пустой активный документ.
  const templates = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { code: true },
    orderBy: { sortOrder: "asc" },
  });
  const existing = new Set(
    (
      await db.journalDocument.findMany({
        where: { organizationId: organization.id },
        select: { template: { select: { code: true } } },
      })
    ).map((d) => d.template.code),
  );
  const extra: Array<{ code: string; created: boolean; reason?: string }> = [];
  for (const { code } of templates) {
    if (!hasDocumentFillUi(code) || existing.has(code)) continue;
    try {
      const report = await ensureActiveDocument(db, {
        organizationId: organization.id,
        templateCode: code,
        autoFill: false,
      });
      extra.push({ code, created: report.created, reason: report.reason });
    } catch (error) {
      extra.push({ code, created: false, reason: String((error as Error).message).slice(0, 160) });
    }
  }
  console.log("extra documents", extra);

  const docs = await db.journalDocument.findMany({
    where: { organizationId: organization.id },
    select: { id: true, title: true, status: true, template: { select: { code: true, name: true } } },
    orderBy: [{ template: { sortOrder: "asc" } }, { createdAt: "asc" }],
  });
  const creds = {
    password: PASSWORD,
    managerEmail,
    managerId: manager.id,
    organizationId: organization.id,
    documents: docs.map((d) => ({
      id: d.id,
      code: d.template.code,
      journal: d.template.name,
      title: d.title,
      status: d.status,
    })),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "creds.json"), JSON.stringify(creds, null, 2));
  console.log(`documents: ${docs.length}; creds → ${path.join(OUT, "creds.json")}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
