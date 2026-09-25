// Стенд для снимков мини-приложения: организация, руководитель и повар с
// привязанным Telegram, цех и холодильник. Документы журналов создаёт
// prepare.ts через API (нужен запущенный dev-сервер).
// Запуск: npx tsx .agent/tasks/mini-qr-style-2026-09/e2e/setup.ts
import bcrypt from "bcryptjs";

import { db } from "./db";

import { ORG_ID, PASSWORD, USERS } from "./fixtures";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: { name: "Кафе «Север»", isDemo: false },
    create: {
      id: ORG_ID,
      name: "Кафе «Север»",
      type: "restaurant",
      phone: "+79990001000",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      isDemo: false,
    },
  });

  for (const [key, u] of Object.entries(USERS)) {
    const categoryKey = key === "manager" ? "management" : "staff";
    const position =
      (await db.jobPosition.findFirst({ where: { organizationId: org.id, name: u.position } })) ??
      (await db.jobPosition.create({ data: { organizationId: org.id, name: u.position, categoryKey } }));
    // Telegram id уникален среди активных: снимаем его с чужих записей.
    await db.user.updateMany({ where: { telegramChatId: u.tg, NOT: { email: u.email } }, data: { telegramChatId: null } });
    const data = {
      name: u.name,
      role: u.role,
      organizationId: org.id,
      jobPositionId: position.id,
      isActive: true,
      archivedAt: null,
      passwordHash,
      phone: key === "manager" ? "+79990001001" : "+79990001002",
      telegramChatId: u.tg,
      journalAccessMigrated: false,
    };
    await db.user.upsert({ where: { email: u.email }, update: data, create: { email: u.email, ...data } });
  }

  const area =
    (await db.area.findFirst({ where: { organizationId: org.id, name: "Горячий цех" } })) ??
    (await db.area.create({ data: { organizationId: org.id, name: "Горячий цех" } }));
  if (!(await db.equipment.findFirst({ where: { areaId: area.id } }))) {
    await db.equipment.create({ data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 } });
    await db.equipment.create({ data: { areaId: area.id, name: "Морозильный ларь", type: "freezer", tempMin: -20, tempMax: -18 } });
  }
  console.log("OK org", org.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
