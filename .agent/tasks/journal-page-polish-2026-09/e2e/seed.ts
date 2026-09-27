/**
 * Данные для e2e journal-page-polish-2026-09 на своей базе (wesetup_wt_jpage):
 * организация «Кафе «Ромашка»» с руководителем (переименовывает журнал, видит
 * QR и «Создать документ») и поваром (без прав), помещения и холодильники —
 * для документа журнала холодильного оборудования.
 *
 * Документы создаёт уже prepare.cjs через API (как кнопка «Создать документ»).
 *
 * Запуск (из C:/wt/jpage): node --import tsx <папка e2e>/seed.ts
 * Пишет creds.json рядом с собой (его читает lib.cjs; в git не попадает).
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wesetup_wt_jpage")) throw new Error("Только своя база wesetup_wt_jpage");

const LEGAL_VERSION = /LEGAL_VERSION = "([^"]+)"/.exec(
  readFileSync("C:/wt/jpage/src/lib/legal-consent.ts", "utf8")
)?.[1];
if (!LEGAL_VERSION) throw new Error("LEGAL_VERSION не найден");

const pool = new pg.Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = "Jpage-2026!";
const stamp = Date.now().toString(36);

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const managerEmail = `jpage.manager.${stamp}@example.com`;
  const cookEmail = `jpage.cook.${stamp}@example.com`;

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: "Кафе «Ромашка»",
        type: "restaurant",
        // Все журналы включены: нужны холодильники и ещё один журнал со вкладками.
        disabledJournalCodes: [],
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
    const cook = await tx.user.create({
      data: {
        email: cookEmail,
        name: "Иван Поваров",
        phone: `+7996${Date.now().toString().slice(-7)}`,
        passwordHash,
        role: "cook",
        organizationId: organization.id,
        journalAccessMigrated: false,
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
    const cold = await tx.area.create({ data: { name: "Холодный цех", organizationId: organization.id } });
    const store = await tx.area.create({ data: { name: "Склад", organizationId: organization.id } });
    await tx.equipment.createMany({
      data: [
        { name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6, areaId: cold.id },
        { name: "Морозильный ларь", type: "freezer", tempMin: -20, tempMax: -18, areaId: cold.id },
        { name: "Холодильная камера склада", type: "refrigerator", tempMin: 0, tempMax: 4, areaId: store.id },
      ],
    });
    return { organizationId: organization.id, managerId: manager.id, cookId: cook.id };
  });

  const creds = { password: PASSWORD, managerEmail, cookEmail, ...result };
  writeFileSync(path.join(path.dirname(process.argv[1]), "creds.json"), JSON.stringify(creds, null, 2));
  console.log(JSON.stringify(creds, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
