import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/positions/<positionId>/journals
 *
 * Body: { templateCodes: string[] }
 *
 * Перезаписывает белый список журналов, разрешённых данной должности
 * (`JobPositionJournalAccess` rows для этой `jobPositionId` в текущей
 * орге). Симметрично к
 * `/api/settings/journals/[code]/distribution` — там перезаписывается
 * со стороны template, тут со стороны position. Один и тот же набор
 * строк, разный угол редактирования.
 *
 * Семантика пустого массива:
 *   templateCodes = []  → у должности нет ни одного allowed-шаблона.
 *   Это намеренный «закрытый» режим (вся работа должна делаться через
 *   индивидуальные UserJournalAccess override). Back-compat «нет
 *   позиций → разрешено всем» работает на стороне template, а не
 *   position, поэтому стирание position-rows не возвращает её в
 *   «доступно всё».
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { positionId } = await params;
  const organizationId = getActiveOrgId(session);

  const position = await db.jobPosition.findFirst({
    where: { id: positionId, organizationId },
    select: { id: true },
  });
  if (!position) {
    return NextResponse.json(
      { error: "Должность не найдена" },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const codesRaw = (body as { templateCodes?: unknown }).templateCodes;
  const templateCodes: string[] = Array.isArray(codesRaw)
    ? codesRaw.filter(
        (c: unknown): c is string => typeof c === "string" && c.length > 0
      )
    : [];

  let templateIds: string[] = [];
  if (templateCodes.length > 0) {
    const templates = await db.journalTemplate.findMany({
      where: { code: { in: templateCodes } },
      select: { id: true, code: true },
    });
    if (templates.length !== templateCodes.length) {
      const found = new Set(templates.map((t) => t.code));
      const missing = templateCodes.filter((c) => !found.has(c));
      return NextResponse.json(
        { error: `Шаблоны не найдены: ${missing.join(", ")}` },
        { status: 400 }
      );
    }
    templateIds = templates.map((t) => t.id);
  }

  await db.$transaction([
    db.jobPositionJournalAccess.deleteMany({
      where: { jobPositionId: positionId, organizationId },
    }),
    ...(templateIds.length > 0
      ? [
          db.jobPositionJournalAccess.createMany({
            data: templateIds.map((templateId) => ({
              templateId,
              organizationId,
              jobPositionId: positionId,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true, count: templateIds.length });
}
