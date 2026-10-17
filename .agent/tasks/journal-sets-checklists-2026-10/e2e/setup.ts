/**
 * Подготовка локальной проверки (база wesetup_e2e, НЕ прод):
 * - две новые организации через настоящий путь создания `createOrganization`
 *   («Ресторан» и «Производство») — проверка AC5 на базе;
 * - руководитель и повар ресторана с известным паролем — для проверки API.
 *
 * Запуск из корня worktree: npx tsx .agent/tasks/journal-sets-checklists-2026-10/e2e/setup.ts
 * Повторный запуск пересоздаёт тестовые организации.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

import { createOrganization } from "@/lib/create-organization";
import { db } from "@/lib/db";

const PASSWORD = "JournalSets-2026!";
const HOME_ORG = "e2e-org-loc";
const OUT = path.join(".agent", "tasks", "journal-sets-checklists-2026-10", "raw", "e2e-state.json");

async function main() {
  if (!/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("Только локальная база wesetup_e2e");

  const passwordHash = await bcrypt.hash(PASSWORD, 8);
  // Чистим прошлый прогон.
  const oldUsers = await db.user.findMany({ where: { email: { in: ["js-manager@e2e.local", "js-cook@e2e.local"] } }, select: { id: true } });
  await db.account.deleteMany({ where: { ownerUserId: { in: oldUsers.map((u) => u.id) } } });
  await db.organization.deleteMany({ where: { name: { startsWith: "JS-тест" } } });
  await db.user.deleteMany({ where: { email: { in: ["js-manager@e2e.local", "js-cook@e2e.local"] } } });

  const manager = await db.user.create({
    data: {
      email: "js-manager@e2e.local",
      name: "Проверка Наборов",
      role: "manager",
      organizationId: HOME_ORG,
      passwordHash,
      isActive: true,
      journalAccessMigrated: true,
    },
    select: { id: true },
  });
  // Оплаченная подписка: иначе после бесплатного периода окно выбора тарифа
  // перекрывает кабинет (в ресторане два сотрудника).
  const account = await db.account.create({
    data: { ownerUserId: manager.id, subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 30 * 86_400_000) },
    select: { id: true },
  });

  const restaurant = await createOrganization({ name: "JS-тест Ресторан", sphere: "restaurant", accountId: account.id, ownerUserId: manager.id });
  const production = await createOrganization({ name: "JS-тест Производство", sphere: "production", accountId: account.id, ownerUserId: manager.id });

  // Домашняя организация руководителя — новый ресторан: сессия смотрит в него.
  await db.user.update({ where: { id: manager.id }, data: { organizationId: restaurant.organizationId } });
  const cook = await db.user.create({
    data: {
      email: "js-cook@e2e.local",
      name: "Повар Проверки",
      role: "cook",
      organizationId: restaurant.organizationId,
      passwordHash,
      isActive: true,
      journalAccessMigrated: true,
    },
    select: { id: true },
  });

  const orgs = await db.organization.findMany({
    where: { id: { in: [restaurant.organizationId, production.organizationId] } },
    select: { id: true, name: true, type: true, disabledJournalCodes: true },
  });
  const state = { password: PASSWORD, managerId: manager.id, cookId: cook.id, restaurant: restaurant.organizationId, production: production.organizationId, orgs };
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ restaurant: restaurant.organizationId, production: production.organizationId }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
