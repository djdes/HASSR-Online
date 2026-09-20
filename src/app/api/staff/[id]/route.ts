import { NextResponse } from "next/server";
import { z } from "zod";
import { setEmployeeQrPin } from "@/lib/qr-fill-actor";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { normalizeWeeklyDaysOff } from "@/lib/staff-days-off";

const patchSchema = z.object({
  /// Недельное правило выходных: 0=Пн … 6=Вс.
  weeklyDaysOff: z.array(z.number().int().min(0).max(6)).optional(),
  /// PIN для QR-форм: 4–6 цифр, `null` — снять.
  qrPin: z.string().max(12).nullable().optional(),
});

/**
 * PATCH /api/staff/[id]
 *
 * Пока умеет только недельное правило выходных — его правят чипами
 * «Пн…Вс» прямо в графике, и тащить ради этого тяжёлый PUT
 * /api/users/[id] (роль, телефон, автосвязка с TasksFlow) избыточно.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = getActiveOrgId(session);

  let parsed;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Не удалось прочитать запрос" },
      { status: 400 }
    );
  }

  const user = await db.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  if (parsed.qrPin !== undefined) {
    const pinError = await setEmployeeQrPin(user.id, parsed.qrPin);
    if (pinError) return NextResponse.json({ error: pinError }, { status: 400 });
  }
  if (parsed.weeklyDaysOff === undefined) {
    return NextResponse.json({ ok: true, qrPinSet: parsed.qrPin !== null && parsed.qrPin !== undefined });
  }
  const weeklyDaysOff = normalizeWeeklyDaysOff(parsed.weeklyDaysOff);
  await db.user.update({ where: { id: user.id }, data: { weeklyDaysOff } });

  return NextResponse.json({ ok: true, weeklyDaysOff });
}

/**
 * DELETE /api/staff/[id]
 *
 * Hard-deletes the employee when safe, 409 otherwise so the UI can surface
 * the "delete blocked — please archive" modal. "Safe" means the employee is
 * not referenced by any journal evidence:
 *
 *  - JournalEntry.filledById — the old structured-journal world. FK is
 *    restrict-by-default, so Prisma would throw here anyway; we pre-check to
 *    give a better error message.
 *  - JournalDocumentEntry.employeeId — the newer document-based world.
 *    Column is a plain String without FK, so the DB wouldn't stop us, but
 *    hard-deleting would orphan the audit trail. Block the delete instead.
 *
 * Cascades in the schema handle the clean-up: UserJournalAccess, InviteToken,
 * StaffWorkOffDay, StaffVacation, StaffSickLeave, StaffDismissal all
 * cascade-delete on `User`. FeedbackReport / TelegramLog have nullable userId
 * and happily null out.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = getActiveOrgId(session);

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "Нельзя удалить свою собственную учётную запись" },
      { status: 400 }
    );
  }

  const user = await db.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, isRoot: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }
  if (user.isRoot) {
    return NextResponse.json(
      { error: "ROOT-учётную запись удалить нельзя" },
      { status: 400 }
    );
  }

  const [journalEntries, documentEntries] = await Promise.all([
    db.journalEntry.count({ where: { filledById: user.id } }),
    db.journalDocumentEntry.count({ where: { employeeId: user.id } }),
  ]);
  const total = journalEntries + documentEntries;

  if (total > 0) {
    return NextResponse.json(
      {
        error:
          "Данный сотрудник участвует в журналах. Удаление не возможно. Если сотрудник уволился, то перенесите его в архив.",
        blocked: true,
        references: total,
      },
      { status: 409 }
    );
  }

  // Room.cleanerUserIds / verifierUserIds — String[] без FK: вычищаем
  // id сотрудника, чтобы карточки помещений не ссылались на удалённого.
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
  await db.$transaction([
    ...rooms.map((room) =>
      db.room.update({
        where: { id: room.id },
        data: {
          cleanerUserIds: room.cleanerUserIds.filter((x) => x !== user.id),
          verifierUserIds: room.verifierUserIds.filter((x) => x !== user.id),
        },
      }),
    ),
    db.user.delete({ where: { id: user.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
