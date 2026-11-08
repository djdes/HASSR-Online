/**
 * One-shot: роль РОП (CRM).
 *
 * 1. alexey@wesetup.ru (владелец, 2026-11-07: «добавь возможность выдать роль
 *    РОП … Сейчас РОП alexey@wesetup.ru»).
 * 2. Владелец/руководитель компании «БФС» с подключённым Telegram (владелец,
 *    2026-11-08: «назначь ропа так же где компания бфс и подключен телеграм на
 *    оповещения»). Компания — по ИНН ООО «БФС», названию, юр. названию или
 *    снимку ЕГРЮЛ организации, где человек работает или состоит участником. Совпало больше
 *    трёх человек — ничего не выдаём (неоднозначно), выдать можно в /root/team.
 *
 * Выдача идёт тем же путём, что переключатель «РОП» в «Команде и доступах»
 * (`setPlatformSections` с `salesHead: true`): раздел «CRM» добавляется,
 * если его нет, остальные разделы не трогаем; аудит и оповещение человеку.
 * Владельцу платформы (`isRoot`) разделы не нужны — ставим только флаг РОП.
 *
 * Однократно, своя отметка на каждую цель (`once:crm-rop:<цель>:v1` в
 * PlatformSetting) — дальше ролью управляет владелец в /root/team, снятую
 * роль следующий деплой не вернёт. Пока подходящего пользователя нет — отметку
 * не пишем, шаг повторится. Репозиторий публичный: в лог деплоя — только id и
 * маска почты.
 *
 * Запуск: npx tsx prisma/seed-crm-rop-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import "dotenv/config";

import type { Prisma } from "@prisma/client";

import { db } from "../src/lib/db";
import { notifySalesHeadGranted } from "../src/lib/crm/sales-head-notice.server";
import { normalizePlatformSections } from "../src/lib/platform-access";
import { platformOrgId } from "../src/lib/partners/partner-hint";
import { maskEmail } from "../src/lib/platform-admin";
import { setPlatformSections } from "../src/lib/platform-team.server";

const ROP_EMAIL = "alexey@wesetup.ru";
const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[crm-rop:dry-run]" : "[crm-rop]";

/**
 * Организация «БФС» — ООО «БФС», юрлицо WeSetup (ИНН 5018215599, см. оферту):
 * по ИНН, названию, полному юр. названию или названию из снимка ЕГРЮЛ. Первый
 * деплой искал только по названию и не нашёл: у организации своё имя, а «БФС»
 * — в реквизитах.
 */
const BFS_INN = "5018215599";
const BFS_NAMES = ["БФС", "BFS"];
const bfsOrganization: Prisma.OrganizationWhereInput = {
  OR: [
    { inn: BFS_INN },
    ...BFS_NAMES.flatMap((name) => [
      { name: { contains: name, mode: "insensitive" as const } },
      { legalFullName: { contains: name, mode: "insensitive" as const } },
      { legalProfileJson: { path: ["nameShort"], string_contains: name } },
      { legalProfileJson: { path: ["nameFull"], string_contains: name } },
    ]),
  ],
};

type Target = { onceKey: string; label: string; where: Prisma.UserWhereInput; max: number };

const TARGETS: Target[] = [
  {
    onceKey: "once:crm-rop:alexey:v1",
    label: ROP_EMAIL,
    where: { email: { equals: ROP_EMAIL, mode: "insensitive" } },
    max: 1,
  },
  {
    onceKey: "once:crm-rop:bfs:v1",
    label: "компания «БФС», Telegram подключён",
    where: {
      telegramChatId: { not: null },
      AND: [
        { OR: [{ isRoot: true }, { role: { in: ["owner", "manager"] } }] },
        {
          OR: [
            { organization: bfsOrganization },
            { organizationMemberships: { some: { organization: bfsOrganization } } },
            // Платформа WeSetup — это и есть ООО «БФС»: её владелец и команда
            // панели (у кого уже есть разделы), а не любой аккаунт в ней.
            { organizationId: platformOrgId(), OR: [{ isRoot: true }, { platformSections: { isEmpty: false } }] },
          ],
        },
      ],
    },
    max: 3,
  },
];

const USER_SELECT = { id: true, email: true, name: true, isRoot: true, isActive: true, platformSections: true, platformSalesHead: true } as const;

async function grant(target: Target, owner: { id: string; name: string; organizationId: string } | null): Promise<boolean> {
  const users = await db.user.findMany({
    where: { ...target.where, archivedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
    take: target.max + 1,
    select: USER_SELECT,
  });
  const who = (user: { id: string; email: string }) => `${user.id} ${maskEmail(user.email)}`;
  if (!users.length) {
    console.log(`${TAG} ${target.label}: никого — повторим на следующем деплое`);
    return false;
  }
  if (users.length > target.max) {
    console.log(`${TAG} ${target.label}: совпало больше ${target.max} (${users.map(who).join(", ")}) — не выдаём, назначьте в /root/team`);
    return false;
  }
  for (const user of users) {
    if (user.platformSalesHead) {
      console.log(`${TAG} ${target.label}: ${who(user)} уже РОП`);
      continue;
    }
    if (user.isRoot) {
      // У владельца платформы разделы не выдаются — только флаг РОП.
      console.log(`${TAG} ${target.label}: ${who(user)} — владелец платформы, ставим флаг РОП`);
      if (DRY_RUN) continue;
      await db.user.update({ where: { id: user.id }, data: { platformSalesHead: true } });
      await db.auditLog
        .create({ data: { organizationId: owner?.organizationId ?? "platform", userId: owner?.id ?? null, userName: "seed", action: "platform.access.update", entity: "user", entityId: user.id, details: { salesHead: true, salesHeadBefore: false, via: target.onceKey } } })
        .catch(() => undefined);
      await notifySalesHeadGranted({ userId: user.id, grantedBy: null }).catch(() => false);
      continue;
    }
    if (!owner) {
      console.log(`${TAG} ${target.label}: владелец платформы не найден — повторим на следующем деплое`);
      return false;
    }
    const current = normalizePlatformSections(user.platformSections);
    // РОП работает в CRM (раздел «CRM», 2026-11-08).
    const sections = current.includes("crm") ? current : [...current, "crm" as const];
    console.log(`${TAG} ${target.label}: ${who(user)} → РОП, разделы ${current.join(",") || "—"} → ${sections.join(",")}`);
    if (DRY_RUN) continue;
    const member = await setPlatformSections({ user: owner }, user.id, sections, { salesHead: true, waitForNotice: true });
    console.log(`${TAG} ${target.label}: готово, salesHead=${member.salesHead}`);
  }
  return true;
}

async function main() {
  const owner = await db.user.findFirst({
    where: { isRoot: true, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, organizationId: true },
  });
  for (const target of TARGETS) {
    if (await db.platformSetting.findUnique({ where: { key: target.onceKey } })) {
      console.log(`${TAG} ${target.label}: already done`);
      continue;
    }
    const done = await grant(target, owner);
    if (done && !DRY_RUN) await db.platformSetting.create({ data: { key: target.onceKey, value: new Date().toISOString() } });
  }
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
