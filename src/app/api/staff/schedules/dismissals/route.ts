import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";

const createSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseDayUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * POST records a dismissal AND archives the user — one-to-one link guaranteed
 * by the schema's @unique(userId).
 */
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

  const user = await db.user.findFirst({
    where: { id: parsed.userId, organizationId: orgId },
    select: { id: true, isRoot: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }
  if (user.isRoot) {
    return NextResponse.json(
      { error: "ROOT-учётную запись нельзя уволить" },
      { status: 400 }
    );
  }

  const date = parseDayUtc(parsed.date);
  // Zod regex принимает `2026-13-99` — без проверки мы сохраняем
  // Invalid Date в staffDismissal.date и user.archivedAt, что ломает
  // фильтры "архив" / "увольнения" в UI.
  if (!Number.isFinite(date.getTime())) {
    return NextResponse.json(
      { error: "Некорректная дата увольнения" },
      { status: 400 }
    );
  }
  const row = await db.staffDismissal.upsert({
    where: { userId: user.id },
    create: { userId: user.id, date },
    update: { date },
  });
  await db.user.update({
    where: { id: user.id },
    data: { archivedAt: date, isActive: false },
  });
  return NextResponse.json({ row });
}
