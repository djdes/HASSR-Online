/**
 * One-shot: роль «Администратор» панели платформы для alexey@wesetup.ru и
 * оповещение ему (владелец, 2026-11-06: «дай доступ админа для
 * alexey@wesetup.ru и оповести его»).
 *
 * Выдача идёт тем же путём, что кнопка в «Команде и доступах»
 * (`setPlatformSections`): все разделы, отметка «кто выдал» — владелец
 * платформы, запись в аудит, письмо и Telegram человеку.
 *
 * Однократно: после выдачи пишем PlatformSetting `once:platform-admin:alexey:v1`
 * — дальше доступом управляет владелец в /root/team, снятый доступ следующий
 * деплой не вернёт. Пока пользователя нет, маркер не пишем: шаг повторится.
 * Владельца платформы (`isRoot`) не трогаем — у него и так открыто всё.
 *
 * Запуск: npx tsx prisma/seed-platform-admin-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { PLATFORM_SECTION_KEYS } from "../src/lib/platform-access";
import { setPlatformSections } from "../src/lib/platform-team.server";

const ONCE_KEY = "once:platform-admin:alexey:v1";
const ADMIN_EMAIL = "alexey@wesetup.ru";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const tag = DRY_RUN ? "[platform-admin:dry-run]" : "[platform-admin]";
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${tag} already done`);
    return;
  }

  const target = await db.user.findFirst({
    where: { email: { equals: ADMIN_EMAIL, mode: "insensitive" }, archivedAt: null },
    select: { id: true, name: true, isRoot: true, isActive: true, platformSections: true },
  });
  if (!target) {
    console.log(`${tag} ${ADMIN_EMAIL} not found — will retry next deploy`);
    return;
  }
  if (target.isRoot) {
    console.log(`${tag} ${ADMIN_EMAIL} is the platform owner — nothing to grant`);
    if (!DRY_RUN) await db.platformSetting.create({ data: { key: ONCE_KEY, value: new Date().toISOString() } });
    return;
  }
  if (!target.isActive) {
    console.log(`${tag} ${ADMIN_EMAIL} is deactivated — will retry next deploy`);
    return;
  }

  const owner = await db.user.findFirst({
    where: { isRoot: true, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, organizationId: true },
  });
  if (!owner) {
    console.log(`${tag} platform owner not found — will retry next deploy`);
    return;
  }

  console.log(`${tag} ${ADMIN_EMAIL} (${target.name}): ${target.platformSections.join(",") || "—"} → all ${PLATFORM_SECTION_KEYS.length} sections, granted by ${owner.name}`);
  if (DRY_RUN) return;

  const member = await setPlatformSections({ user: owner }, target.id, [...PLATFORM_SECTION_KEYS], { waitForNotice: true });
  await db.platformSetting.create({ data: { key: ONCE_KEY, value: new Date().toISOString() } });
  console.log(`${tag} granted: ${member.sections.length} sections; notice email=${member.notice?.email ?? false} telegram=${member.notice?.telegram ?? false}`);
}

main()
  .catch((error) => {
    console.error("[platform-admin] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
    // Почта, Telegram и пул БД держат таймеры — без явного выхода шаг деплоя ждал бы до таймаута.
    process.exit(process.exitCode ?? 0);
  });
