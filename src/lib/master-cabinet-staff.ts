import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiresAt } from "@/lib/invite-tokens";
import { MasterCabinetError } from "@/lib/master-cabinet-error";

/**
 * Приглашение в мастер-кабинет. Решение владельца 30.09 (вечер): человек
 * закреплён за самим кабинетом (домашняя организация — кабинет), а кабинет
 * считается сотрудником в каждом подключённом пищеблоке
 * (`master-cabinet-seats.ts`). Группа «Мастер-кабинет» осталась от
 * приглашённых днём сотрудниками организаций: их места не считаются, при
 * «Убрать» — архив.
 */

export const MASTER_CABINET_POSITION_NAME = "Мастер-кабинет";
const MASTER_CABINET_POSITION_CATEGORY = "staff";
/** Права группы по умолчанию: только главная — всё остальное владелец включит сам. */
const MASTER_CABINET_POSITION_PERMISSIONS = ["dashboard.view"];

/** Группа «Мастер-кабинет» в организации — создаётся при первом приглашении. */
export async function ensureMasterCabinetPosition(
  organizationId: string,
  tx: Prisma.TransactionClient | typeof db = db
) {
  return tx.jobPosition.upsert({
    where: {
      organizationId_categoryKey_name: {
        organizationId,
        categoryKey: MASTER_CABINET_POSITION_CATEGORY,
        name: MASTER_CABINET_POSITION_NAME,
      },
    },
    create: {
      organizationId,
      categoryKey: MASTER_CABINET_POSITION_CATEGORY,
      name: MASTER_CABINET_POSITION_NAME,
      permissionsJson: MASTER_CABINET_POSITION_PERMISSIONS,
      sortOrder: 900,
    },
    update: {},
    select: { id: true, name: true },
  });
}

export type MasterCabinetInvite = {
  user: { id: string; name: string; email: string };
  inviteUrl: string;
  /** Человек уже был приглашён или возвращается из архива — выдана новая ссылка. */
  reinvited: boolean;
};

/**
 * Пригласить по почте в мастер-кабинет: аккаунт, закреплённый за кабинетом.
 * Повтор (ещё не вошёл, из архива, приглашённый днём сотрудник организации,
 * ещё не вошедший) — новая ссылка; занятый чужой email — отказ.
 */
export async function inviteMasterCabinetEmployee(input: {
  cabinetId: string;
  name: string;
  email: string;
  /** Проверка мест тарифа (кабинет) — для нового или возвращаемого из архива. */
  beforeCreate?: (cabinetId: string) => Promise<void>;
}): Promise<MasterCabinetInvite> {
  const existing = await db.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" } },
    select: { id: true, organizationId: true, isActive: true, archivedAt: true, isRoot: true },
  });

  if (existing) {
    if (existing.isRoot) throw new MasterCabinetError("Этот email занят — укажите другой адрес", 409);
    const legacyCabinetUser = existing.organizationId === input.cabinetId;
    if (existing.isActive && !existing.archivedAt) {
      throw new MasterCabinetError(
        legacyCabinetUser
          ? "У этого человека уже есть доступ к кабинету"
          : "Этот человек уже есть в WeSetup — дайте ему доступ через «Дать доступ сотруднику».",
        409
      );
    }
    const pendingMember =
      !existing.archivedAt &&
      Boolean(
        await db.organizationMember.findUnique({
          where: { userId_organizationId: { userId: existing.id, organizationId: input.cabinetId } },
          select: { id: true },
        })
      );
    if (!legacyCabinetUser && !pendingMember) {
      throw new MasterCabinetError(
        "Этот email уже есть в WeSetup. Если это ваш сотрудник — дайте ему доступ через «Дать доступ сотруднику».",
        409
      );
    }
    if (existing.archivedAt && input.beforeCreate) await input.beforeCreate(input.cabinetId);
  } else if (input.beforeCreate) {
    await input.beforeCreate(input.cabinetId);
  }

  const raw = generateInviteToken();
  const tokenHash = hashInviteToken(raw);
  const expiresAt = inviteExpiresAt();
  const user = await db.$transaction(async (tx) => {
    let saved: { id: string; name: string; email: string; organizationId: string };
    if (existing) {
      const inCabinetOnly = existing.organizationId === input.cabinetId;
      saved = await tx.user.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          isActive: false,
          archivedAt: null,
          ...(inCabinetOnly ? {} : { lastActiveOrganizationId: input.cabinetId }),
        },
        select: { id: true, name: true, email: true, organizationId: true },
      });
    } else {
      // Закреплён за кабинетом (решение владельца 30.09): домашняя организация —
      // сам кабинет, после входа он сразу в /master.
      saved = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: "",
          role: "manager",
          organizationId: input.cabinetId,
          isActive: false,
        },
        select: { id: true, name: true, email: true, organizationId: true },
      });
    }
    if (saved.organizationId !== input.cabinetId) {
      await tx.organizationMember.upsert({
        where: { userId_organizationId: { userId: saved.id, organizationId: input.cabinetId } },
        create: { userId: saved.id, organizationId: input.cabinetId, role: "manager" },
        update: {},
      });
    }
    // Приглашение у человека одно (InviteToken.userId уникален): прежняя ссылка перестаёт действовать.
    await tx.inviteToken.deleteMany({ where: { userId: saved.id } });
    await tx.inviteToken.create({ data: { userId: saved.id, tokenHash, expiresAt } });
    return saved;
  });

  return {
    user: { id: user.id, name: user.name, email: user.email },
    inviteUrl: buildInviteUrl(raw),
    reinvited: Boolean(existing),
  };
}
