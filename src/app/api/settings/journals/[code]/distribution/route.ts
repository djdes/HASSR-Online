import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { FILL_MODES, type FillMode } from "@/lib/journal-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/journals/<code>/distribution
 *
 * Body:
 *   fillMode: "per-employee" | "single" | "sensor"
 *   defaultAssigneeId: string | null   // только для single, иначе null
 *   allowedPositionIds: string[]       // [] = разрешено всем должностям
 *
 * Management-only. Upsert'ит fillMode + defaultAssigneeId на
 * `JournalTemplate` (глобально для всех орг — это property шаблона)
 * и ПЕРЕЗАПИСЫВАЕТ JobPositionJournalAccess для текущей орги
 * (`organizationId` из сессии).
 *
 * NB: fillMode + defaultAssigneeId хранятся на JournalTemplate, а не
 * per-org, потому что Шаблоны общие для всех. На практике значит:
 * один и тот же fillMode у всех орг. Это устраивает MVP — все
 * рестораны типично хотят одинаковое поведение «гигиена per-employee,
 * climate single». В будущем можно перенести в per-org override-таблицу.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { code } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const fillMode = body.fillMode as unknown;
  if (
    typeof fillMode !== "string" ||
    !(FILL_MODES as readonly string[]).includes(fillMode)
  ) {
    return NextResponse.json(
      { error: `fillMode должен быть одним из ${FILL_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  const defaultAssigneeId =
    typeof body.defaultAssigneeId === "string" && body.defaultAssigneeId
      ? body.defaultAssigneeId
      : null;

  const allowedPositionIds: string[] = Array.isArray(body.allowedPositionIds)
    ? body.allowedPositionIds.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0
      )
    : [];

  const bonusAmountKopecks =
    typeof body.bonusAmountKopecks === "number" &&
    Number.isFinite(body.bonusAmountKopecks) &&
    body.bonusAmountKopecks >= 0
      ? Math.floor(body.bonusAmountKopecks)
      : 0;

  const organizationId = getActiveOrgId(session);

  const template = await db.journalTemplate.findUnique({
    where: { code },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  // Проверяем что defaultAssigneeId — это пользователь текущей орги.
  if (defaultAssigneeId) {
    const user = await db.user.findFirst({
      where: { id: defaultAssigneeId, organizationId },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: "defaultAssigneeId не принадлежит организации" },
        { status: 400 }
      );
    }
  }

  // Проверяем что все position-id — это позиции текущей орги.
  if (allowedPositionIds.length > 0) {
    const positions = await db.jobPosition.findMany({
      where: { id: { in: allowedPositionIds }, organizationId },
      select: { id: true },
    });
    if (positions.length !== allowedPositionIds.length) {
      return NextResponse.json(
        { error: "Некоторые должности не принадлежат организации" },
        { status: 400 }
      );
    }
  }

  await db.$transaction([
    db.journalTemplate.update({
      where: { id: template.id },
      data: {
        fillMode: fillMode as FillMode,
        defaultAssigneeId,
        bonusAmountKopecks,
      },
    }),
    db.jobPositionJournalAccess.deleteMany({
      where: { templateId: template.id, organizationId },
    }),
    ...(allowedPositionIds.length > 0
      ? [
          db.jobPositionJournalAccess.createMany({
            data: allowedPositionIds.map((jobPositionId) => ({
              templateId: template.id,
              organizationId,
              jobPositionId,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
