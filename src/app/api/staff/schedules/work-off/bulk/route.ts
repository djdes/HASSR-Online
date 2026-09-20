import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { planWorkOffBulk } from "@/lib/staff-days-off";

/**
 * POST /api/staff/schedules/work-off/bulk
 *
 * Одна транзакция на всю «покраску» графика выходных: раньше каждая
 * ячейка стреляла отдельным POST + `router.refresh()`, и протянуть
 * курсором две недели по пяти сотрудникам означало 70 запросов и 70
 * перерисовок страницы.
 *
 * Идемпотентность: план строит `planWorkOffBulk` — по каждой паре
 * (userId, date) остаётся последнее значение, а строка в БД заводится
 * только если день расходится с недельным правилом `weeklyDaysOff`.
 * Повторная отправка того же тела ничего не меняет.
 */
const bulkSchema = z.object({
  items: z
    .array(
      z.object({
        userId: z.string().min(1),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD"),
        enabled: z.boolean(),
      })
    )
    .min(1, "Пустой список")
    // Сетка показывает 20 дней × штат — верхняя граница с запасом,
    // чтобы кривой клиент не прислал мегабайты.
    .max(2000, "Слишком много ячеек за один раз"),
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
    parsed = bulkSchema.parse(await request.json());
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

  const requestedUserIds = [...new Set(parsed.items.map((i) => i.userId))];
  const users = await db.user.findMany({
    where: { id: { in: requestedUserIds }, organizationId: orgId },
    select: { id: true, weeklyDaysOff: true },
  });
  if (users.length !== requestedUserIds.length) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  // Zod-регулярка пропускает `2026-13-99` — до БД такое доходить не должно.
  for (const item of parsed.items) {
    if (!Number.isFinite(parseDayUtc(item.date).getTime())) {
      return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    }
  }

  const weeklyByUserId = new Map(users.map((u) => [u.id, u.weeklyDaysOff]));
  const plan = planWorkOffBulk(parsed.items, weeklyByUserId);

  await db.$transaction([
    ...plan.deletes.map((row) =>
      db.staffWorkOffDay.deleteMany({
        where: { userId: row.userId, date: parseDayUtc(row.date) },
      })
    ),
    ...plan.upserts.map((row) =>
      db.staffWorkOffDay.upsert({
        where: {
          userId_date: { userId: row.userId, date: parseDayUtc(row.date) },
        },
        create: { userId: row.userId, date: parseDayUtc(row.date), kind: row.kind },
        update: { kind: row.kind },
      })
    ),
  ]);

  return NextResponse.json({
    ok: true,
    changed: plan.upserts.length + plan.deletes.length,
  });
}
