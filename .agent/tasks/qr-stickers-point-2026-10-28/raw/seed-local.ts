/**
 * Тестовые данные для проверки точки на QR-наклейках и «‹ Назад» в сайдбаре.
 * Только локальная база wesetup_memos на 127.0.0.1:5432 (НЕ прод) — та же,
 * что у памяток (.agent/tasks/memos-point-2026-10-28/raw/seed-local.ts):
 * организации, точки и владельцы берутся оттуда, здесь — цеха, оборудование,
 * помещения (склады) и повар.
 *
 * - «org-dk» (журналы по точкам): «Горячий цех» точки № 5 (холодильник, УФ-лампа,
 *   фритюрница), «Холодный цех» гимназии № 112 (длинное наименование для
 *   журналов, морозильный ларь), «Склад общий» без точки (холодильник);
 *   склады в точках и архив в офисе.
 * - «org-one» (одна точка, журналы общие): цех без точки, холодильник, склад.
 * - «org-none» (точек нет): цех и холодильник — строки точки нет.
 * Запуск (после сида памяток):
 *   DATABASE_URL=…/wesetup_memos npx tsx .agent/tasks/qr-stickers-point-2026-10-28/raw/seed-local.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("/wesetup_memos")) throw new Error("Только тестовая база wesetup_memos");
  const orgs = await db.organization.count({ where: { id: { in: ["org-dk", "org-one", "org-none"] } } });
  if (orgs !== 3) throw new Error("Сначала сид памяток: .agent/tasks/memos-point-2026-10-28/raw/seed-local.ts");

  // Склад общий — цех организации без точки; остальные цеха — своих точек.
  const areas = [
    { id: "a-dk-5-hot", organizationId: "org-dk", name: "Горячий цех", buildingId: "b-dk-5" },
    { id: "a-dk-112-cold", organizationId: "org-dk", name: "Холодный цех", buildingId: "b-dk-112" },
    { id: "a-dk-shared", organizationId: "org-dk", name: "Склад общий", buildingId: null },
    { id: "a-one-kitchen", organizationId: "org-one", name: "Кухня", buildingId: null },
    { id: "a-none-kitchen", organizationId: "org-none", name: "Кухня", buildingId: null },
  ];
  for (const area of areas) {
    await db.area.upsert({ where: { id: area.id }, update: { name: area.name, buildingId: area.buildingId }, create: area });
  }

  const equipment = [
    { id: "e-dk-5-fridge", areaId: "a-dk-5-hot", name: "Холодильник молочный", type: "refrigerator", tempMin: 2, tempMax: 6 },
    { id: "e-dk-5-uv", areaId: "a-dk-5-hot", name: "УФ-лампа над столом", type: "uv_lamp", tempMin: null, tempMax: null },
    { id: "e-dk-5-fryer", areaId: "a-dk-5-hot", name: "Фритюрница", type: "fryer", tempMin: null, tempMax: null },
    { id: "e-dk-112-freezer", areaId: "a-dk-112-cold", name: "Морозильный ларь", type: "freezer", tempMin: -25, tempMax: -18 },
    { id: "e-dk-shared-fridge", areaId: "a-dk-shared", name: "Холодильник склада", type: "refrigerator", tempMin: 0, tempMax: 4 },
    { id: "e-one-fridge", areaId: "a-one-kitchen", name: "Холодильник № 1", type: "refrigerator", tempMin: 2, tempMax: 6 },
    // Название в две строки на наклейке — проверка, что текст под кодом не обрезается.
    { id: "e-one-long", areaId: "a-one-kitchen", name: "Холодильник для молочной продукции и полуфабрикатов", type: "refrigerator", tempMin: 2, tempMax: 6 },
    { id: "e-none-fridge", areaId: "a-none-kitchen", name: "Холодильник", type: "refrigerator", tempMin: 2, tempMax: 6 },
  ];
  for (const item of equipment) {
    await db.equipment.upsert({ where: { id: item.id }, update: { ...item }, create: item });
  }

  const rooms = [
    { id: "r-dk-5-dry", buildingId: "b-dk-5", name: "Склад сухих продуктов", kind: "warehouse" },
    { id: "r-dk-112-veg", buildingId: "b-dk-112", name: "Овощной склад", kind: "warehouse" },
    { id: "r-dk-office-archive", buildingId: "b-dk-office", name: "Архив документов", kind: "other" },
    { id: "r-one-store", buildingId: "b-one", name: "Склад", kind: "warehouse" },
  ];
  for (const room of rooms) {
    await db.room.upsert({ where: { id: room.id }, update: { name: room.name, buildingId: room.buildingId }, create: room });
  }

  // Повар точки № 5: без полного доступа, его «главная» — «Журналы» (внутри раздела).
  const passwordHash = await bcrypt.hash("Test-12345", 10);
  await db.user.upsert({
    where: { email: "dk-cook@test.local" },
    update: { passwordHash, legalVersion: LEGAL_VERSION, showWhatsNew: false, buildingIds: ["b-dk-5"] },
    create: {
      id: "u-dk-cook",
      email: "dk-cook@test.local",
      name: "Сергей Повар",
      organizationId: "org-dk",
      buildingIds: ["b-dk-5"],
      role: "cook",
      permissionPreset: "cook",
      isActive: true,
      journalAccessMigrated: false,
      passwordHash,
      phone: "+79990000001",
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
    },
  });
  // Заведующая: без полного доступа, её «главная» — «Журналы» → панель контроля.
  await db.user.upsert({
    where: { email: "dk-chef@test.local" },
    update: { passwordHash, legalVersion: LEGAL_VERSION, showWhatsNew: false, buildingIds: [] },
    create: {
      id: "u-dk-chef",
      email: "dk-chef@test.local",
      name: "Мария Заведующая",
      organizationId: "org-dk",
      buildingIds: [],
      role: "head_chef",
      permissionPreset: "head_chef",
      isActive: true,
      journalAccessMigrated: false,
      passwordHash,
      phone: "+79990000002",
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
    },
  });
  console.log("seeded areas", areas.length, "equipment", equipment.length, "rooms", rooms.length, "+ cook, head chef");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
