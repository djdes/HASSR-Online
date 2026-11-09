/**
 * One-shot: роли панели платформы (владелец, 2026-11-08: «продумай роль
 * менеджера… РОП по всем… настройка ролей доступов к разделам админки,
 * сделай alexey@wesetup.ru коммерческий директор»).
 *
 * 1. Встроенные роли (`BUILTIN_ROLES`) — создаются, если их нет; правки
 *    владельца не перезаписываются (повторный запуск безопасен).
 * 2. `once:platform-roles:crm-section:v1` — CRM вынесена из «Продаж» в свой
 *    раздел: всем, у кого есть «Продажи», добавляется «CRM» — ни у кого
 *    доступ не меняется, администраторы остаются администраторами.
 * 3. `once:platform-roles:link:v1` — человек без роли, чей набор разделов
 *    и флаг РОП точно совпадают со встроенной ролью, получает эту роль
 *    (доступ тот же; дальше им управляет роль). Остальные — «свой набор».
 * 4. `once:platform-roles:alexey-cd:v1` — alexey@wesetup.ru: роль
 *    «Коммерческий директор», должность в подписи «Коммерческий директор».
 * 5. Лимиты скидки встроенных ролей (пустые → 25 / 15 / 10 %) — каждый запуск,
 *    только незаполненные.
 *
 * Запуск: npx tsx prisma/seed-platform-roles-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml. В лог — только id и маска почты.
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { normalizePlatformSections } from "../src/lib/platform-access";
import { maskEmail } from "../src/lib/platform-admin";
import { ensureBuiltinRoles, fillBuiltinDiscountLimits } from "../src/lib/platform-roles.server";
import { setPlatformSections } from "../src/lib/platform-team.server";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[platform-roles:dry-run]" : "[platform-roles]";
const COMMERCIAL_DIRECTOR_EMAIL = "alexey@wesetup.ru";
const COMMERCIAL_DIRECTOR_TITLE = "Коммерческий директор";

async function once(key: string, run: () => Promise<boolean>) {
  if (await db.platformSetting.findUnique({ where: { key } })) {
    console.log(`${TAG} ${key}: already done`);
    return;
  }
  const done = await run();
  if (done && !DRY_RUN) await db.platformSetting.create({ data: { key, value: new Date().toISOString() } });
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

async function main() {
  if (DRY_RUN) {
    const missing = await db.platformRole.count();
    console.log(`${TAG} roles in DB: ${missing} (built-ins are created on a real run)`);
  } else {
    console.log(`${TAG} built-in roles created: ${await ensureBuiltinRoles()}`);
    // Лимиты скидки спец-КП (автоворонка CRM, 2026-11-09): только пустые, правки владельца не трогаем.
    console.log(`${TAG} discount limits filled: ${await fillBuiltinDiscountLimits()}`);
  }

  await once("once:platform-roles:crm-section:v1", async () => {
    const users = await db.user.findMany({
      where: { platformSections: { has: "sales" }, NOT: { platformSections: { has: "crm" } } },
      select: { id: true, email: true, platformSections: true },
    });
    for (const user of users) {
      console.log(`${TAG} crm section → ${user.id} ${maskEmail(user.email)}`);
      if (!DRY_RUN) await db.user.update({ where: { id: user.id }, data: { platformSections: normalizePlatformSections([...user.platformSections, "crm"]) } });
    }
    console.log(`${TAG} crm section added: ${users.length}`);
    return true;
  });

  await once("once:platform-roles:link:v1", async () => {
    const roles = await db.platformRole.findMany({ where: { system: true } });
    if (!roles.length) {
      console.log(`${TAG} no built-in roles yet — will link on the next run`);
      return false;
    }
    const users = await db.user.findMany({
      where: { isRoot: false, platformRoleId: null, archivedAt: null, platformSections: { isEmpty: false } },
      select: { id: true, email: true, platformSections: true, platformSalesHead: true },
    });
    let linked = 0;
    for (const user of users) {
      const sections = normalizePlatformSections(user.platformSections);
      const role = roles.find((item) => item.salesHead === user.platformSalesHead && sameSet(normalizePlatformSections(item.sections), sections));
      if (!role) continue;
      linked += 1;
      console.log(`${TAG} role «${role.title}» → ${user.id} ${maskEmail(user.email)}`);
      if (!DRY_RUN) await db.user.update({ where: { id: user.id }, data: { platformRoleId: role.id } });
    }
    console.log(`${TAG} linked to roles: ${linked} of ${users.length}`);
    return true;
  });

  await once("once:platform-roles:alexey-cd:v1", async () => {
    const target = await db.user.findFirst({
      where: { email: { equals: COMMERCIAL_DIRECTOR_EMAIL, mode: "insensitive" }, archivedAt: null, isActive: true },
      select: { id: true, email: true, isRoot: true },
    });
    const role = await db.platformRole.findUnique({ where: { key: "commercial_director" } });
    const owner = await db.user.findFirst({ where: { isRoot: true, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, organizationId: true } });
    if (!target || !role || !owner) {
      console.log(`${TAG} commercial director: ${!target ? "user" : !role ? "role" : "owner"} not found — will retry next deploy`);
      return false;
    }
    console.log(`${TAG} commercial director → ${target.id} ${maskEmail(target.email)}`);
    if (DRY_RUN) return false;
    if (target.isRoot) {
      await db.user.update({ where: { id: target.id }, data: { platformTitle: COMMERCIAL_DIRECTOR_TITLE, platformSalesHead: true } });
      return true;
    }
    const member = await setPlatformSections({ user: owner }, target.id, [], { roleId: role.id, title: COMMERCIAL_DIRECTOR_TITLE, waitForNotice: true });
    console.log(`${TAG} commercial director: role=${member.roleTitle} title=${member.title} salesHead=${member.salesHead} sections=${member.sections.length}`);
    return true;
  });
}

main()
  .catch((error) => {
    console.error("[platform-roles] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
