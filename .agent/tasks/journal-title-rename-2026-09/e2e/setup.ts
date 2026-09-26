/**
 * Данные для e2e «Своё название журнала с его страницы» на своей базе
 * (wesetup_wt_jtitle): организация с руководителем (переименовывает,
 * отключает журнал) и поваром (карандаша не видит, API отвечает 403).
 *
 * Запуск (из C:/wt/jtitle):
 *   npx tsx .agent/tasks/journal-title-rename-2026-09/e2e/setup.ts > .agent/tasks/journal-title-rename-2026-09/e2e/setup-output.json
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";

import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wesetup_wt_jtitle")) throw new Error("Только своя база wesetup_wt_jtitle");

const pool = new pg.Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = "Jtitle-2026!";
const stamp = Date.now().toString(36);
/** Журнал со скриншота владельца. */
const JOURNAL = "cold_equipment_control";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const managerEmail = `jtitle.manager.${stamp}@example.com`;
  const cookEmail = `jtitle.cook.${stamp}@example.com`;

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: "Кафе «Ромашка»",
        type: "restaurant",
        // Журнал со скриншота — включён, остальное как у новой организации.
        disabledJournalCodes: defaultDisabledCodesFor("restaurant").filter((code) => code !== JOURNAL),
        subscriptionPlan: "free",
      },
    });
    const manager = await tx.user.create({
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
    });
    const account = await tx.account.create({
      data: { ownerUserId: manager.id, subscriptionPlan: "free" },
    });
    await tx.organization.update({ where: { id: organization.id }, data: { accountId: account.id } });
    await tx.organizationMember.create({
      data: { userId: manager.id, organizationId: organization.id, role: "owner" },
    });
    // Повар: без прав на «Названия». До переноса доступов видит все журналы.
    const cook = await tx.user.create({
      data: {
        email: cookEmail,
        name: "Иван Поваров",
        passwordHash,
        role: "cook",
        organizationId: organization.id,
        journalAccessMigrated: false,
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
    return { organizationId: organization.id, managerId: manager.id, cookId: cook.id };
  });

  console.log(
    JSON.stringify(
      { password: PASSWORD, journal: JOURNAL, managerEmail, cookEmail, ...result },
      null,
      2
    )
  );
  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
