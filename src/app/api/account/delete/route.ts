import { NextResponse } from "next/server";

import {
  anonymizedUserData,
  isAccountDeleteConfirmed,
  isOrganizationOwner,
  planAccountDeletion,
} from "@/lib/account-deletion";
import { recordAuditLog } from "@/lib/audit-log";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { getVerifierSlotId } from "@/lib/journal-responsible-schemas";
import { notifyManagement } from "@/lib/notifications";
import { getServerSession } from "@/lib/server-session";
import { bumpSessionVersion } from "@/lib/session-version";
import { getDbRoleValuesWithLegacy, isManagementRole, MANAGEMENT_ROLES } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete  { confirm: "УДАЛИТЬ" }
 *
 * Человек удаляет свой аккаунт сам (профиль и страница /delete-account —
 * требование App Store и Google Play). Решение — `planAccountDeletion`:
 *   200 { ok: true }                 — аккаунт обезличен, сессии отозваны;
 *   409 { error, redirect }          — владелец: удалить компанию
 *                                      (с отсрочкой 30 дней);
 *   403 { error }                    — ROOT, демо-кабинет, общий планшет, партнёр,
 *                                      последний руководитель-не владелец
 *                                      (причина — в `error`, её показывает экран);
 *   400 { error: "Введите УДАЛИТЬ" } — нет подтверждения;
 *   401 { error }                    — нет сессии.
 *
 * Для сотрудника — те же последствия, что у архивирования в «Сотрудниках»
 * (`api/staff/[id]/archive`): снять со слотов журналов, из областей
 * руководителей, должностей и помещений, известить руководство об
 * освободившихся журналах. Плюс обезличивание и отзыв всех способов входа.
 * Записи журналов остаются — это данные компании.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Войдите, чтобы удалить аккаунт" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!isAccountDeleteConfirmed(body)) {
    return NextResponse.json({ error: "Введите УДАЛИТЬ" }, { status: 400 });
  }
  if (session.user.kioskDeviceId) {
    return NextResponse.json(
      { error: "На общем планшете аккаунт удалить нельзя — откройте профиль на своём телефоне." },
      { status: 403 },
    );
  }
  if (session.user.partnerAccess) {
    return NextResponse.json(
      { error: "Сейчас вы работаете в кабинете клиента. Вернитесь в свой кабинет, чтобы удалить аккаунт." },
      { status: 403 },
    );
  }

  const userId = session.user.id;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      isRoot: true,
      organizationId: true,
      organization: { select: { isDemo: true } },
      ownedAccount: { select: { id: true } },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Аккаунт не найден" }, { status: 404 });
  }
  // «Домашняя» организация: там его должность, слоты и журналы.
  const orgId = user.organizationId;

  const [ownerMembership, otherManagersCount] = await Promise.all([
    db.organizationMember.findFirst({
      where: { userId, organizationId: orgId, role: "owner" },
      select: { id: true },
    }),
    db.user.count({
      where: {
        organizationId: orgId,
        id: { not: userId },
        isActive: true,
        archivedAt: null,
        isRoot: false,
        role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
      },
    }),
  ]);

  const plan = planAccountDeletion({
    isRoot: user.isRoot,
    isOwnerOfOrganization: isOrganizationOwner({
      role: user.role,
      ownsAccount: Boolean(user.ownedAccount),
      hasOwnerMembership: Boolean(ownerMembership),
    }),
    isManagement: isManagementRole(user.role),
    otherManagersCount,
    isDemoOrganization: user.organization.isDemo,
  });
  if (plan.kind === "forbidden") {
    return NextResponse.json({ error: plan.reason }, { status: 403 });
  }
  if (plan.kind === "organization") {
    return NextResponse.json(
      {
        error: "Вы владелец компании: удалите компанию — аккаунт удалится вместе с ней",
        redirect: plan.href,
      },
      { status: 409 },
    );
  }

  const originalName = user.name;
  const codeToName = new Map<string, string>(
    ACTIVE_JOURNAL_CATALOG.map((j) => [j.code as string, j.name]),
  );
  type Orphan = { journalCode: string; journalName: string; slotIds: string[] };

  const orphans = await db.$transaction(async (tx) => {
    // 1. Слоты ответственных за журналы — как при архивировании.
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { journalResponsibleUsersJson: true },
    });
    const slotsByJournal = (org?.journalResponsibleUsersJson ?? {}) as Record<
      string,
      Record<string, string | null>
    >;
    const found: Orphan[] = [];
    for (const [code, slots] of Object.entries(slotsByJournal)) {
      if (!slots || typeof slots !== "object") continue;
      const slotIds: string[] = [];
      for (const [slotId, uid] of Object.entries(slots)) {
        if (uid === userId) {
          slots[slotId] = null;
          slotIds.push(slotId);
        }
      }
      if (slotIds.length > 0) {
        found.push({ journalCode: code, journalName: codeToName.get(code) ?? code, slotIds });
      }
    }
    if (found.length > 0) {
      await tx.organization.update({
        where: { id: orgId },
        data: { journalResponsibleUsersJson: slotsByJournal as never },
      });
    }

    // 2. Области видимости руководителей, должности, помещения.
    const scopes = await tx.managerScope.findMany({
      where: { organizationId: orgId, viewUserIds: { has: userId } },
      select: { id: true, viewUserIds: true },
    });
    for (const sc of scopes) {
      await tx.managerScope.update({
        where: { id: sc.id },
        data: { viewUserIds: sc.viewUserIds.filter((id) => id !== userId) },
      });
    }
    const positions = await tx.jobPosition.findMany({
      where: { organizationId: orgId, visibleUserIds: { has: userId } },
      select: { id: true, visibleUserIds: true },
    });
    for (const p of positions) {
      await tx.jobPosition.update({
        where: { id: p.id },
        data: { visibleUserIds: p.visibleUserIds.filter((id) => id !== userId) },
      });
    }
    const rooms = await tx.room.findMany({
      where: {
        building: { organizationId: orgId },
        OR: [{ cleanerUserIds: { has: userId } }, { verifierUserIds: { has: userId } }],
      },
      select: { id: true, cleanerUserIds: true, verifierUserIds: true },
    });
    for (const room of rooms) {
      await tx.room.update({
        where: { id: room.id },
        data: {
          cleanerUserIds: room.cleanerUserIds.filter((id) => id !== userId),
          verifierUserIds: room.verifierUserIds.filter((id) => id !== userId),
        },
      });
    }

    // 3. Все способы входа и личное вне карточки.
    await tx.webPushSubscription.deleteMany({ where: { userId } });
    await tx.mobileDevice.deleteMany({ where: { userId } });
    await tx.webAuthnCredential.deleteMany({ where: { userId } });
    await tx.webAuthnChallenge.deleteMany({ where: { userId } });
    await tx.inviteToken.deleteMany({ where: { userId } });
    await tx.botInviteToken.deleteMany({ where: { userId } });
    await tx.staffPairToken.deleteMany({ where: { userId } });
    await tx.personalLoginToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.qrPinRequest.deleteMany({ where: { userId } });
    await tx.organizationMember.deleteMany({ where: { userId } });
    await tx.assistantConversation.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    // Связь с TasksFlow держится на телефоне, который стираем. Удаляем
    // только свою строку связи; сам аккаунт TasksFlow — его домен (П-5, П-12).
    await tx.tasksFlowUserLink.deleteMany({ where: { wesetupUserId: userId } });

    // 4. Карточка: обезличить, выключить, отозвать все сессии.
    await tx.user.update({
      where: { id: userId },
      data: { ...anonymizedUserData(userId), sessionVersion: { increment: 1 } },
    });
    return found;
  }, { timeout: 20_000 });

  // Версия уже выросла в транзакции; bump ещё раз обновляет кеш версии в
  // этом процессе — иначе старый токен проходил бы проверку до минуты.
  await bumpSessionVersion(userId).catch((error) => {
    console.error("[account-delete] session bump failed", error);
  });

  await recordAuditLog({
    organizationId: orgId,
    session: { user: { id: userId, name: originalName } },
    request,
    action: "account.deleted",
    entity: "User",
    entityId: userId,
    details: { orphanedJournals: orphans.length },
  });

  if (orphans.length > 0) {
    const items = orphans.map((o) => {
      const isVerifier = o.slotIds.includes(getVerifierSlotId(o.journalCode));
      const slotLabel =
        isVerifier && o.slotIds.length === 1
          ? "проверяющий"
          : o.slotIds.length === 1
            ? "ответственный"
            : "несколько слотов";
      return {
        id: o.journalCode,
        label: o.journalName,
        hint: `Освободился ${slotLabel}. Назначь нового сотрудника.`,
        href: `/settings/journal-responsibles?fix=${encodeURIComponent(
          o.journalCode,
        )}&reason=${encodeURIComponent(`Сотрудник ${originalName} удалил свой аккаунт — слот пуст`)}`,
      };
    });
    await notifyManagement({
      organizationId: orgId,
      kind: "staff.archived.responsibles_orphan",
      dedupeKey: `staff.archived:${userId}`,
      title: `Сотрудник «${originalName}» удалил свой аккаунт — освободились слоты в журналах`,
      linkHref: "/settings/journal-responsibles",
      linkLabel: "Открыть Ответственных",
      items,
    }).catch((error) => console.error("[account-delete] notify failed", error));
  }

  return NextResponse.json({ ok: true });
}
