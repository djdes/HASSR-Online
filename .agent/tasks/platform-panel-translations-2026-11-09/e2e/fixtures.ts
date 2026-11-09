/**
 * Локальные люди для проверки «Переводы — в панели, панель с разрешёнными
 * вкладками». Только для локальной БД (DATABASE_URL на 127.0.0.1).
 *
 *   npx tsx .agent/tasks/platform-panel-translations-2026-11-09/e2e/fixtures.ts
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { db } from "../../../../src/lib/db";
import { LEGAL_VERSION } from "../../../../src/lib/legal-consent";
import { ensureBuiltinRoles } from "../../../../src/lib/platform-roles.server";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("fixtures: only for a local database");
  process.exit(1);
}

async function main() {
  await ensureBuiltinRoles();
  const roles = new Map((await db.platformRole.findMany()).map((role) => [role.key, role]));
  const role = (key: string) => {
    const found = roles.get(key);
    if (!found) throw new Error(`role ${key} missing`);
    return { platformRoleId: found.id, platformSections: found.sections, platformSalesHead: found.salesHead };
  };
  const passwordHash = await bcrypt.hash("LocalUser-2026!", 10);

  const cafe = await db.organization.upsert({
    where: { id: "fixture-cafe" },
    update: {},
    create: { id: "fixture-cafe", name: "Кафе «Ромашка»", type: "restaurant" },
  });

  const people = [
    // Как на проде: коммерческий директор и первый переводчик.
    { email: "alexey@wesetup.ru", name: "Алексей", organizationId: "platform", canEditTranslations: true, ...role("commercial_director") },
    { email: "admin@wesetup.local.test", name: "Ольга (администратор)", organizationId: "platform", canEditTranslations: false, ...role("admin") },
    { email: "seo@wesetup.local.test", name: "Сергей (SEO)", organizationId: "platform", canEditTranslations: false, ...role("seo") },
    { email: "manager@wesetup.local.test", name: "Мария (менеджер)", organizationId: "platform", canEditTranslations: false, ...role("sales_manager") },
    // Переводчик без разделов панели — внешний человек из клиентской организации.
    { email: "translator@wesetup.local.test", name: "Дилноза (переводчик)", organizationId: cafe.id, canEditTranslations: true, platformRoleId: null, platformSections: [], platformSalesHead: false },
    { email: "ivan@romashka-cafe.ru", name: "Иван Петров", organizationId: cafe.id, canEditTranslations: false, platformRoleId: null, platformSections: [], platformSalesHead: false },
  ];
  // Без окон поверх кабинета: документы приняты, анкета заполнена, «Что нового» выключено.
  const quiet = { legalVersion: LEGAL_VERSION, showWhatsNew: false };
  for (const [index, person] of people.entries()) {
    const data = {
      ...person,
      ...quiet,
      phone: `+7900000000${index}`,
      role: person.organizationId === "platform" ? "manager" : person.email.startsWith("ivan") ? "owner" : "manager",
      passwordHash,
      isActive: true,
      journalAccessMigrated: true,
    };
    await db.user.upsert({ where: { email: person.email }, update: data, create: data });
  }
  await db.user.updateMany({ where: { isRoot: true }, data: { ...quiet, phone: "+79000000099" } });
  const rows = await db.user.findMany({
    where: { email: { in: people.map((person) => person.email) } },
    select: { email: true, canEditTranslations: true, platformSections: true, platformRole: { select: { key: true } } },
    orderBy: { email: "asc" },
  });
  for (const row of rows) {
    console.log(`${row.email.padEnd(32)} translator=${row.canEditTranslations} role=${row.platformRole?.key ?? "-"} sections=${row.platformSections.join(",") || "-"}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
