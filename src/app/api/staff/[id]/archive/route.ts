import { NextResponse } from "next/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { notifyManagement } from "@/lib/notifications";
import {
  ACTIVE_JOURNAL_CATALOG,
} from "@/lib/journal-catalog";
import { getVerifierSlotId } from "@/lib/journal-responsible-schemas";

async function guard(id: string, orgId: string) {
  const user = await db.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, archivedAt: true, isRoot: true },
  });
  return user;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const { id } = await params;
  const orgId = getActiveOrgId(session);
  const user = await guard(id, orgId);
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }
  if (user.isRoot) {
    return NextResponse.json(
      { error: "ROOT-учётную запись нельзя архивировать" },
      { status: 400 }
    );
  }
  if (user.id === session.user.id) {
    return NextResponse.json(
      { error: "Нельзя архивировать самого себя" },
      { status: 400 }
    );
  }

  // 1. Снять юзера со всех journal slots в Organization.journalResponsibleUsersJson.
  //    Найти все journal codes где он был slot user, поставить null,
  //    и собрать список «осиротевших» журналов для notification.
  const orgRecord = await db.organization.findUnique({
    where: { id: orgId },
    select: { journalResponsibleUsersJson: true, name: true },
  });
  const slotsByJournal = (orgRecord?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    Record<string, string | null>
  >;
  type Orphan = { journalCode: string; journalName: string; slotIds: string[] };
  const orphans: Orphan[] = [];
  let mutated = false;
  const codeToName = new Map<string, string>(
    ACTIVE_JOURNAL_CATALOG.map((j) => [j.code as string, j.name]),
  );
  for (const [code, slots] of Object.entries(slotsByJournal)) {
    if (!slots || typeof slots !== "object") continue;
    const orphanSlotIds: string[] = [];
    for (const [slotId, uid] of Object.entries(slots)) {
      if (uid === user.id) {
        slots[slotId] = null;
        orphanSlotIds.push(slotId);
        mutated = true;
      }
    }
    if (orphanSlotIds.length > 0) {
      orphans.push({
        journalCode: code,
        journalName: codeToName.get(code) ?? code,
        slotIds: orphanSlotIds,
      });
    }
  }

  // 2. Убрать юзера из manager-scopes (viewUserIds — список юзеров,
  //    которых видит этот manager-scope). Prisma не умеет atomically
  //    remove element из String[] — fetch+update.
  const scopes = await db.managerScope.findMany({
    where: {
      organizationId: orgId,
      viewUserIds: { has: user.id },
    },
    select: { id: true, viewUserIds: true },
  });
  for (const sc of scopes) {
    await db.managerScope.update({
      where: { id: sc.id },
      data: {
        viewUserIds: sc.viewUserIds.filter((sid: string) => sid !== user.id),
      },
    });
  }

  // 3. Убрать из JobPosition.visibleUserIds (если кто-то его «видел»).
  const positions = await db.jobPosition.findMany({
    where: {
      organizationId: orgId,
      visibleUserIds: { has: user.id },
    },
    select: { id: true, visibleUserIds: true },
  });
  for (const p of positions) {
    await db.jobPosition.update({
      where: { id: p.id },
      data: {
        visibleUserIds: p.visibleUserIds.filter((vid) => vid !== user.id),
      },
    });
  }

  // 3a. Убрать из Room.cleanerUserIds / verifierUserIds. Раньше чистил
  //     только hard-delete, и архивный уборщик оставался закреплён за
  //     помещением: карточка помещения потом вообще отказывалась
  //     сохраняться («сотрудник в архиве»), пока его не снимали руками.
  const rooms = await db.room.findMany({
    where: {
      building: { organizationId: orgId },
      OR: [
        { cleanerUserIds: { has: user.id } },
        { verifierUserIds: { has: user.id } },
      ],
    },
    select: { id: true, cleanerUserIds: true, verifierUserIds: true },
  });
  for (const room of rooms) {
    await db.room.update({
      where: { id: room.id },
      data: {
        cleanerUserIds: room.cleanerUserIds.filter((rid) => rid !== user.id),
        verifierUserIds: room.verifierUserIds.filter((rid) => rid !== user.id),
      },
    });
  }

  // 4. Сам archive — атомарно: archive + сохранение очищенного slotsJson.
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { archivedAt: new Date(), isActive: false },
    }),
    ...(mutated
      ? [
          db.organization.update({
            where: { id: orgId },
            data: {
              journalResponsibleUsersJson: slotsByJournal as never,
            },
          }),
        ]
      : []),
  ]);

  // 5. Если были orphan-журналы — нотификация менеджменту с deep-link.
  if (orphans.length > 0) {
    const userInfo = await db.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    const items = orphans.map((o) => {
      // Уточняем какой именно slot осиротел: filler vs verifier.
      const verifierSlotId = getVerifierSlotId(o.journalCode);
      const isVerifier = o.slotIds.includes(verifierSlotId);
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
        )}&reason=${encodeURIComponent(
          `Сотрудник ${userInfo?.name ?? "?"} архивирован — слот пуст`,
        )}`,
      };
    });
    await notifyManagement({
      organizationId: orgId,
      kind: "staff.archived.responsibles_orphan",
      dedupeKey: `staff.archived:${user.id}`,
      title: `Сотрудник «${userInfo?.name ?? "?"}» архивирован — освободились слоты в журналах`,
      linkHref: "/settings/journal-responsibles",
      linkLabel: "Открыть Ответственных",
      items,
    });
  }

  return NextResponse.json({
    ok: true,
    orphanedJournals: orphans.length,
    journalCodes: orphans.map((o) => o.journalCode),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const { id } = await params;
  const orgId = getActiveOrgId(session);
  const user = await guard(id, orgId);
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      archivedAt: null,
      isActive: true,
    },
  });
  return NextResponse.json({ ok: true });
}
