import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { computePresetAssignments } from "@/lib/journal-responsible-presets";
import { cascadeResponsibleToActiveDocuments } from "@/lib/journal-responsibles-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/journal-responsibles/apply-presets
 *
 * Один клик: применяет умные пресеты — для каждого журнала кладёт
 * подходящие должности (например, «Уборка → уборщикам», «Температура
 * → поварам»). Существующие назначения в журналах из пресета
 * ПЕРЕЗАПИСЫВАЮТСЯ. Журналы, не покрытые ни одним пресетом, остаются
 * как есть.
 *
 * Дополнительно для каждого затронутого журнала каскадно ставит
 * responsibleUserId на ВСЕХ активных документах — выбираем первого
 * подходящего сотрудника (alphabetical) из назначенных должностей.
 * Это даёт «всё сразу же заполнено в документе» эффект.
 *
 * Возвращает summary: сколько журналов и сколько документов обновлено.
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);

  const positions = await db.jobPosition.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  if (positions.length === 0) {
    return NextResponse.json(
      {
        error:
          "В организации нет должностей. Создайте сотрудников и должности " +
          "перед применением пресетов.",
      },
      { status: 400 }
    );
  }

  const assignments = computePresetAssignments(positions);
  if (assignments.size === 0) {
    return NextResponse.json({
      ok: true,
      journalsUpdated: 0,
      documentsUpdated: 0,
      message:
        "Ни одна должность не подошла под имена пресетов (например, нет " +
        "«уборщицы», «повара» и т.д.). Переименуйте должности или " +
        "проставьте вручную.",
    });
  }

  const codes = [...assignments.keys()];
  const templates = await db.journalTemplate.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const idByCode = new Map(templates.map((t) => [t.code, t.id]));

  let journalsUpdated = 0;
  let documentsUpdated = 0;
  for (const [code, positionIds] of assignments.entries()) {
    const templateId = idByCode.get(code);
    if (!templateId) continue;
    await db.$transaction([
      db.jobPositionJournalAccess.deleteMany({
        where: { templateId, organizationId },
      }),
      db.jobPositionJournalAccess.createMany({
        data: [...positionIds].map((jobPositionId) => ({
          templateId,
          organizationId,
          jobPositionId,
        })),
      }),
    ]);
    const cascade = await cascadeResponsibleToActiveDocuments({
      organizationId,
      templateId,
      journalCode: code,
      positionIds: [...positionIds],
      slotUsers: undefined,
    });
    documentsUpdated += cascade.documentsUpdated;
    journalsUpdated += 1;
  }

  return NextResponse.json({
    ok: true,
    journalsUpdated,
    documentsUpdated,
  });
}
