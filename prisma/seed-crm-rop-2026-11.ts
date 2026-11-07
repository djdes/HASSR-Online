/**
 * One-shot: роль РОП (CRM) для alexey@wesetup.ru (владелец, 2026-11-07:
 * «добавь возможность выдать роль РОП … Сейчас РОП alexey@wesetup.ru»).
 *
 * Выдача идёт тем же путём, что переключатель «РОП» в «Команде и доступах»
 * (`setPlatformSections` с `salesHead: true`): раздел «Продажи» добавляется,
 * если его нет, остальные разделы не трогаем; аудит и оповещение человеку.
 *
 * Однократно: после выдачи пишем PlatformSetting `once:crm-rop:alexey:v1` —
 * дальше ролью управляет владелец в /root/team, снятую роль следующий деплой
 * не вернёт. Пока пользователя нет — маркер не пишем, шаг повторится.
 *
 * Запуск: npx tsx prisma/seed-crm-rop-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { normalizePlatformSections } from "../src/lib/platform-access";
import { setPlatformSections } from "../src/lib/platform-team.server";

const ONCE_KEY = "once:crm-rop:alexey:v1";
const ROP_EMAIL = "alexey@wesetup.ru";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const tag = DRY_RUN ? "[crm-rop:dry-run]" : "[crm-rop]";
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${tag} already done`);
    return;
  }

  const target = await db.user.findFirst({
    where: { email: { equals: ROP_EMAIL, mode: "insensitive" }, archivedAt: null },
    select: { id: true, name: true, isRoot: true, isActive: true, platformSections: true, platformSalesHead: true },
  });
  if (!target) {
    console.log(`${tag} ${ROP_EMAIL} not found — will retry next deploy`);
    return;
  }
  if (!target.isActive) {
    console.log(`${tag} ${ROP_EMAIL} is deactivated — will retry next deploy`);
    return;
  }

  if (target.isRoot) {
    // У владельца платформы разделы не выдаются — только сам флаг РОП.
    console.log(`${tag} ${ROP_EMAIL} is the platform owner — setting the ROP flag only`);
    if (DRY_RUN) return;
    await db.user.update({ where: { id: target.id }, data: { platformSalesHead: true } });
    await db.platformSetting.create({ data: { key: ONCE_KEY, value: new Date().toISOString() } });
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

  const current = normalizePlatformSections(target.platformSections);
  const sections = current.includes("sales") ? current : [...current, "sales"];
  console.log(`${tag} ${ROP_EMAIL} (${target.name}): ROP ${target.platformSalesHead ? "already" : "→ on"}, sections ${current.join(",") || "—"} → ${sections.join(",")}`);
  if (DRY_RUN) return;

  const member = await setPlatformSections({ user: owner }, target.id, sections, { salesHead: true, waitForNotice: true });
  await db.platformSetting.create({ data: { key: ONCE_KEY, value: new Date().toISOString() } });
  console.log(`${tag} done: salesHead=${member.salesHead}, ${member.sections.length} sections`);
}

main()
  .catch((error) => {
    console.error("[crm-rop] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
    // Почта, Telegram и пул БД держат таймеры — без явного выхода шаг деплоя ждал бы до таймаута.
    process.exit(process.exitCode ?? 0);
  });
