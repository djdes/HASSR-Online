/**
 * Фикстуры для e2e beauty-and-journals (только локальная база wesetup_wt_mc).
 *
 *  - legacy-орг: «старая» организация, у которой первая волна сентябрьских
 *    журналов уже выключена сидером — на ней проверяем сидер второй волны;
 *  - anketa-орг: только что зарегистрированная (название-заглушка, без
 *    телефона) — e2e выбирает в анкете сферу «Салон красоты»;
 *  - fitness / hotel / restaurant — владельцы для «Заполнить типовыми».
 *
 * Запуск: npx tsx .agent/tasks/beauty-and-journals-2026-09/e2e/make-users.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import { defaultDisabledCodesFor } from "../../../../src/lib/sphere-journal-rules";
import { NEW_JOURNAL_CODES_2026_09 } from "../../../../src/lib/new-journals-default-off";
import { DEFAULT_ORG_NAME, type OrgSphere } from "../../../../src/lib/org-profile";

if (!/wesetup_wt_mc/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("только для локальной базы wesetup_wt_mc");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const PASSWORD = "E2e-pass-123";

async function makeOrg(opts: {
  email: string;
  orgName: string;
  type: OrgSphere;
  disabled: string[];
  phone: string | null;
  userName: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.organizationId } });
  }
  const org = await prisma.organization.create({
    data: {
      name: opts.orgName,
      type: opts.type,
      disabledJournalCodes: opts.disabled as Prisma.InputJsonValue,
    },
  });
  await prisma.user.create({
    data: {
      email: opts.email,
      name: opts.userName,
      role: "owner",
      organizationId: org.id,
      isActive: true,
      journalAccessMigrated: true,
      phone: opts.phone,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  return org.id;
}

async function main() {
  const out: Record<string, string> = {};
  out.legacy = await makeOrg({
    email: "e2e-bj-legacy@wesetup.local",
    orgName: "E2E Старое кафе (bj)",
    type: "cafe",
    // Состояние после первой волны: журнал здоровья и шесть журналов 24.09
    // выключены сидерами, остальное организация не трогала.
    disabled: ["health_check", ...NEW_JOURNAL_CODES_2026_09],
    phone: "+79990000001",
    userName: "Ольга Старожилова",
  });
  out.anketa = await makeOrg({
    email: "e2e-bj-beauty@wesetup.local",
    orgName: DEFAULT_ORG_NAME,
    type: "restaurant",
    disabled: ["health_check"],
    phone: null,
    userName: "e2e-bj-beauty@wesetup.local",
  });
  for (const sphere of ["fitness", "hotel", "restaurant"] as const) {
    out[sphere] = await makeOrg({
      email: `e2e-bj-${sphere}@wesetup.local`,
      orgName: `E2E ${sphere} (bj)`,
      type: sphere,
      disabled: defaultDisabledCodesFor(sphere),
      phone: "+79990000002",
      userName: `Владелец ${sphere}`,
    });
  }
  console.log(JSON.stringify(out, null, 2));
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
