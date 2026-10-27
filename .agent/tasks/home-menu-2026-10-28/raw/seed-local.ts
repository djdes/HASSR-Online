/**
 * Тестовые данные для локальной проверки (только отдельная база
 * wesetup_home_menu на localhost:5432, НЕ прод): организация с офисом и двумя
 * точками, журналы по точкам, владелец и заведующая.
 * Запуск: npx tsx .agent/tasks/home-menu-2026-10-28/raw/seed-local.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("/wesetup_home_menu")) throw new Error("Только тестовая база wesetup_home_menu");
  const passwordHash = await bcrypt.hash("Test-12345", 10);
  const org = await db.organization.upsert({
    where: { id: "org-romashka" },
    update: {},
    create: {
      id: "org-romashka",
      name: "Кафе Ромашка",
      type: "restaurant",
      perLocationJournals: true,
      legalProfileJson: { nameShort: "ООО «Ромашка»" },
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
