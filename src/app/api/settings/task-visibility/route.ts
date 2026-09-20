import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/task-visibility
 * Body: { positionIds: string[] } — должности у которых seesAllTasks=true.
 *
 * При следующей синхронизации с TasksFlow эти юзеры получат isAdmin=true
 * (видят все задачи компании в TF). Все остальные positions автоматически
 * получают seesAllTasks=false. Это даёт администратору единое место для
 * настройки видимости — один клик и сохранил.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);
  const body = await request.json().catch(() => null);
  const positionIdsRaw = (body as { positionIds?: unknown } | null)?.positionIds;
  if (!Array.isArray(positionIdsRaw)) {
    return NextResponse.json(
      { error: "Body должен содержать positionIds: string[]" },
      { status: 400 },
    );
  }
  const positionIds: string[] = positionIdsRaw.filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  // Защита: проверяем что все position принадлежат текущей орге.
  if (positionIds.length > 0) {
    const owned = await db.jobPosition.findMany({
      where: { id: { in: positionIds }, organizationId },
      select: { id: true },
    });
    if (owned.length !== new Set(positionIds).size) {
      return NextResponse.json(
        { error: "Некоторые должности не принадлежат организации" },
        { status: 400 },
      );
    }
  }

  // Двумя updateMany'ями: сначала всем должностям организации seesAllTasks=false,
  // потом выбранным = true. Атомарно через transaction.
  await db.$transaction([
    db.jobPosition.updateMany({
      where: { organizationId },
      data: { seesAllTasks: false },
    }),
    ...(positionIds.length > 0
      ? [
          db.jobPosition.updateMany({
            where: { id: { in: positionIds }, organizationId },
            data: { seesAllTasks: true },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true, count: positionIds.length });
}
