/**
 * Локальный стенд (только локальная база):
 *  - управляющий в организации с журналами — чтобы скачать «Пришла проверка»
 *    одним PDF из браузера; пароль случайный, пишется в файл из argv[2] (вне
 *    репозитория) вместе с почтой;
 *  - тестовые реквизиты исполнителя, если не заполнены: без них счёт (и счёт
 *    гостю) не выставляется — как на проде до заполнения в ROOT.
 * Запуск: npx tsx --env-file=.env .agent/tasks/growth-stage3-2026-11/e2e/prepare-manager.ts <файл.json>
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import bcrypt from "bcryptjs";

import { readPlatformRequisites, writePlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { invoiceRequisitesReady } from "@/lib/invoices/build";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Только для локальной базы: DATABASE_URL должен указывать на 127.0.0.1 или localhost");
}

async function ensureTestRequisites(): Promise<boolean> {
  const current = await readPlatformRequisites();
  if (invoiceRequisitesReady(current)) return false;
  await writePlatformRequisites({
    ...current,
    nameFull: "ООО «Тестовый исполнитель»",
    nameShort: "ООО «Тестовый исполнитель»",
    inn: "1234567890",
    kpp: "123401001",
    ogrn: "1234567890123",
    address: "123456, г. Тестовый, ул. Проверочная, д. 1",
    bank: { name: "Тестовый банк", bik: "044525000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
    head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
  });
  return true;
}

const EMAIL = "stage3-e2e-manager@example.test";

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("Укажите файл для почты и пароля");
  // Организация с наибольшим числом журналов-документов (демо-данные сида).
  const groups = await db.journalDocument.groupBy({ by: ["organizationId"], _count: { _all: true } });
  groups.sort((a, b) => b._count._all - a._count._all);
  const organizationId = groups[0]?.organizationId;
  if (!organizationId) throw new Error("В базе нет журналов — запустите prisma/seed.ts");
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  await db.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, organizationId, role: "manager", isActive: true },
    create: { email: EMAIL, name: "Проверка Этапа", passwordHash, organizationId, role: "manager" },
  });
  const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
  if (await ensureTestRequisites()) console.log("Реквизиты исполнителя: заполнены тестовыми (локальная база)");
  writeFileSync(out, JSON.stringify({ email: EMAIL, password, organizationId, organization: organization.name, documents: groups[0]._count._all }));
  console.log(`Управляющий ${EMAIL} в «${organization.name}» (журналов: ${groups[0]._count._all})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
