// Стенд: организация, сотрудник A с привязанным Telegram, сотрудник B и
// руководитель (у обоих — телефон и пароль, у руководителя вход по почте).
// Запуск: cd C:/wt/fix && npx tsx .agent/tasks/mini-signout-2026-09/e2e/setup.ts
import bcrypt from "bcryptjs";

import fs from "node:fs";
import path from "node:path";

import { ROOT, db } from "./db";
import { ORG_ID, PASSWORD, USERS } from "./fixtures";

// Текущая редакция документов — из исходника (модуль тянет за собой базу приложения).
const LEGAL_VERSION = /LEGAL_VERSION = "([^"]+)"/.exec(
  fs.readFileSync(path.join(ROOT, "src", "lib", "legal-consent.ts"), "utf8"),
)?.[1];
if (!LEGAL_VERSION) throw new Error("не нашёл LEGAL_VERSION");

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: { name: "Кафе «Выход»", isDemo: false },
    create: {
      id: ORG_ID,
      name: "Кафе «Выход»",
      type: "restaurant",
      phone: "+79990002999",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      isDemo: false,
    },
  });

  for (const [key, u] of Object.entries(USERS)) {
    const categoryKey = key === "owner" ? "management" : "staff";
    const position =
      (await db.jobPosition.findFirst({ where: { organizationId: org.id, name: u.position } })) ??
      (await db.jobPosition.create({ data: { organizationId: org.id, name: u.position, categoryKey } }));
    if (u.tg) {
      // Telegram id уникален среди активных: снимаем его с чужих записей.
      await db.user.updateMany({ where: { telegramChatId: u.tg, NOT: { email: u.email } }, data: { telegramChatId: null } });
    }
    const data = {
      name: u.name,
      role: u.role,
      organizationId: org.id,
      jobPositionId: position.id,
      isActive: true,
      archivedAt: null,
      passwordHash,
      phone: u.phone,
      telegramChatId: u.tg,
      journalAccessMigrated: false,
      // Окна «Что нового» и «Обновились документы» на сайте закрыли бы
      // кнопку «Выйти» в шапке — к проверке выхода они не относятся.
      showWhatsNew: false,
      legalVersion: LEGAL_VERSION,
    };
    await db.user.upsert({ where: { email: u.email }, update: data, create: { email: u.email, ...data } });
  }
  const users = await db.user.findMany({
    where: { organizationId: org.id },
    select: { email: true, role: true, phone: true, telegramChatId: true },
    orderBy: { email: "asc" },
  });
  console.log("OK org", org.id, JSON.stringify(users));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
