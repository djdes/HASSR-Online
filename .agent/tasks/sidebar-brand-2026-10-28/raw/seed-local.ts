/**
 * Тестовые данные для локальной проверки шапки меню (только отдельная база
 * wesetup_brand на 127.0.0.1:5432, НЕ прод): организация с ИНН и снимком
 * ЕГРЮЛ, две точки, владелец (admin) и заведующая (без права на оформление).
 * Запуск: npx tsx .agent/tasks/sidebar-brand-2026-10-28/raw/seed-local.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("/wesetup_brand")) throw new Error("Только тестовая база wesetup_brand");
  const passwordHash = await bcrypt.hash("Test-12345", 10);
  const org = await db.organization.upsert({
    where: { id: "org-romashka" },
    update: { logoUrl: null },
    create: {
      id: "org-romashka",
      name: "Кафе Ромашка",
      type: "restaurant",
      inn: "7701234567",
      perLocationJournals: true,
      legalProfileJson: { inn: "7701234567", type: "LEGAL", nameShort: "ООО «Ромашка»", nameFull: "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «РОМАШКА»" },
      disabledJournalCodes: [],
    },
  });
  const buildings = [
    { id: "b-office", name: "Офис", kind: "office", sortOrder: 0, address: null },
    { id: "b-lenina", name: "Ромашка на Ленина", kind: "point", sortOrder: 1, address: "ул. Ленина, 5" },
    { id: "b-mira", name: "Ромашка на Мира", kind: "point", sortOrder: 2, address: "пр. Мира, 12" },
  ];
  for (const building of buildings) {
    await db.building.upsert({
      where: { id: building.id },
      update: {},
      create: { ...building, organizationId: org.id },
    });
  }
  const users = [
    { id: "u-owner", email: "owner@test.local", name: "Ольга Владелец", role: "owner", permissionPreset: "admin" },
    { id: "u-head", email: "head@test.local", name: "Зоя Заведующая", role: "head_chef", permissionPreset: "head_chef" },
  ];
  for (const user of users) {
    await db.user.upsert({
      where: { email: user.email },
      update: { passwordHash, legalVersion: LEGAL_VERSION, showWhatsNew: false },
      create: {
        ...user,
        organizationId: org.id,
        isActive: true,
        journalAccessMigrated: true,
        passwordHash,
        phone: "+79990000000",
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
  }
  console.log("seeded", org.id);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
