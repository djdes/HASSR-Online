/**
 * Данные для e2e «Названия» на своей базе (wesetup_wt_blanks): две
 * организации с руководителями (A — будет переименовывать, B — проверка
 * изоляции) и токен QR-плаката журнала уборки организации A.
 *
 * Запуск (из C:/wt/blanks): npx tsx .agent/tasks/custom-names-2026-09/e2e/setup.ts
 * Пишет JSON с логинами/ид в stdout.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";

import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wesetup_wt_blanks")) throw new Error("Только своя база wesetup_wt_blanks");

const pool = new pg.Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = "Names-2026!";
const stamp = Date.now().toString(36);

async function createOrg(label: string, orgName: string, managerName: string, phone: string) {
  const email = `names.${label}.${stamp}@example.com`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: orgName,
        type: "restaurant",
        disabledJournalCodes: defaultDisabledCodesFor("restaurant"),
        subscriptionPlan: "free",
      },
    });
    const user = await tx.user.create({
      data: {
        email,
        name: managerName,
        phone,
        passwordHash,
        role: "manager",
        organizationId: organization.id,
        journalAccessMigrated: true,
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
    const account = await tx.account.create({
      data: { ownerUserId: user.id, subscriptionPlan: "free" },
    });
    await tx.organization.update({ where: { id: organization.id }, data: { accountId: account.id } });
    await tx.organizationMember.create({
      data: { userId: user.id, organizationId: organization.id, role: "owner" },
    });
    return { organizationId: organization.id, userId: user.id, email };
  });
}

async function main() {
const a = await createOrg("a", "Кафе «Ромашка»", "Анна Смирнова", `+7999${stamp.slice(-7).replace(/\D/g, "1").padStart(7, "1")}`);
const b = await createOrg("b", "Кафе «Соседи»", "Борис Иванов", `+7998${stamp.slice(-7).replace(/\D/g, "2").padStart(7, "2")}`);

const qrCleaningToken = mintQrFillToken("journal", `${a.organizationId}:cleaning`);
const qrHubToken = mintQrFillToken("journal", `${a.organizationId}:all`);

console.log(JSON.stringify({ password: PASSWORD, a, b, qrCleaningToken, qrHubToken }, null, 2));
await prisma.$disconnect();
await pool.end();
}
main().catch((error) => { console.error(error); process.exit(1); });
