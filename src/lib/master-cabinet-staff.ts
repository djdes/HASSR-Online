import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildInviteUrl, generateInviteToken, hashInviteToken, inviteExpiresAt } from "@/lib/invite-tokens";
import { MasterCabinetError } from "@/lib/master-cabinet-error";

/**
 * Люди мастер-кабинета — сотрудники организаций (владелец, 2026-09-30:
 * «нужны стандарты и прозрачность, поэтому все должны быть в сотрудниках,
 * но в своих группах… при создании приглашения нужно указывать
 * организацию»). Приглашённый по почте становится сотрудником выбранной
 * организации в группе «Мастер-кабинет» (права группы — в «Права
 * доступа»), журналов пищеблока не видит и получает доступ к кабинету
 * (`OrganizationMember`). После входа он сразу в кабинете. Считается
 * в лимите сотрудников тарифа, как любой сотрудник организации.
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
 * Пригласить по почте в мастер-кабинет. `organizationId` — организация,
 * в «Сотрудниках» которой будет человек (проверяет вызывающая сторона).
 * Повторное приглашение (ещё не вошёл, из архива, прежний аккаунт только
 * в кабинете) выдаёт новую ссылку; занятый чужой email — отказ.
 * `beforeCreate` — проверка мест тарифа для нового или возвращаемого человека.
 */
export async function inviteMasterCabinetEmployee(input: {
  cabinetId: string;
  organizationId: string;
  name: string;
  email: string;
  beforeCreate?: (organizationId: string) => Promise<void>;
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
    const returningEmployee = existing.organizationId === input.organizationId;
    if (!legacyCabinetUser && !pendingMember && !returningEmployee) {
      throw new MasterCabinetError("Этот email уже занят в WeSetup — укажите другой адрес.", 409);
    }
    if (existing.archivedAt && input.beforeCreate) await input.beforeCreate(existing.organizationId);
  } else if (input.beforeCreate) {
    await input.beforeCreate(input.organizationId);
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
      const position = await ensureMasterCabinetPosition(input.organizationId, tx);
      saved = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: "",
          role: "cook",
          positionTitle: position.name,
          jobPositionId: position.id,
          organizationId: input.organizationId,
          isActive: false,
          // Журналы пищеблока ему не нужны: строгий режим без выданных журналов.
          journalAccessMigrated: true,
          // Первый вход — сразу в кабинет (`resolveActiveOrganizationId`).
          lastActiveOrganizationId: input.cabinetId,
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
