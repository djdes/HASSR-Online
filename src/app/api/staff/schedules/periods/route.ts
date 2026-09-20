import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";

/**
 * One endpoint serves both vacation and sick-leave periods — the payload
 * carries `kind`, and we route to the matching Prisma model. Keeps the
 * UI-side code dead simple (one POST + one DELETE).
 */
const createSchema = z.object({
  kind: z.enum(["vacation", "sick_leave"], { message: "Некорректный тип" }),
  userId: z.string().min(1),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseDayUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  let parsed;
  try {
    parsed = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  const from = parseDayUtc(parsed.dateFrom);
  const to = parseDayUtc(parsed.dateTo);
  // Zod regex проходит `2026-13-99`. Без проверки мы запишем Invalid
  // Date в БД, и потом UI отпуска/больничные ломается на форматировании.
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return NextResponse.json(
      { error: "Некорректная дата периода" },
      { status: 400 }
    );
  }
  if (to < from) {
    return NextResponse.json(
      { error: "Дата окончания раньше даты начала" },
      { status: 400 }
    );
  }

  const user = await db.user.findFirst({
    where: { id: parsed.userId, organizationId: orgId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  if (parsed.kind === "vacation") {
    const row = await db.staffVacation.create({
      data: { userId: user.id, dateFrom: from, dateTo: to },
    });
    return NextResponse.json({ row });
  }
  const row = await db.staffSickLeave.create({
    data: { userId: user.id, dateFrom: from, dateTo: to },
  });
  return NextResponse.json({ row });
}
