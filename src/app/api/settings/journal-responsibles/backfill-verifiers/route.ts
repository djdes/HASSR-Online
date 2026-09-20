import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { cascadeResponsibleToActiveDocuments } from "@/lib/journal-responsibles-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/journal-responsibles/backfill-verifiers
 *
 * Бэкфилл verifierUserId на всех активных документах орги — нужен для
 * двухступенчатой проверки в TasksFlow (verifier-task создаётся ТОЛЬКО
 * если у документа есть `verifierUserId`).
 *
 * Возникало когда документы создавались до фикса recreate-documents
 * (тот endpoint игнорировал `prefill.verifierUserId`). После того как
 * пользователь нажимал «Создать все документы» все 35 docs оставались
 * без verifier'а, и при «Отправить задачи» завед не получала «проверь».
 *
 * Делает то же что и /resync-all, но проще и focused — только пробегает
 * cascade'ом для журналов, у которых есть orgSlots, и обновляет docs.
 *
 * Идемпотентно: если у doc'а уже есть verifierUserId — он остаётся.
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);

  const [templates, accessRows, org] = await Promise.all([
    db.journalTemplate.findMany({
      where: { code: { in: ACTIVE_JOURNAL_CATALOG.map((j) => j.code) } },
      select: { id: true, code: true },
    }),
    db.jobPositionJournalAccess.findMany({
      where: { organizationId },
      select: { templateId: true, jobPositionId: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalResponsibleUsersJson: true },
    }),
  ]);

  const positionsByTemplate = new Map<string, string[]>();
  for (const r of accessRows) {
    const list = positionsByTemplate.get(r.templateId) ?? [];
    list.push(r.jobPositionId);
    positionsByTemplate.set(r.templateId, list);
  }

  const orgSlots = (org?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    Record<string, string | null>
  >;

  // Сколько было без verifier'а ДО — для отчёта пользователю.
  const beforeCount = await db.journalDocument.count({
    where: { organizationId, status: "active", verifierUserId: null },
  });

  let documentsUpdated = 0;
  for (const tpl of templates) {
    const slots = orgSlots[tpl.code];
    if (!slots) continue;
    const cascade = await cascadeResponsibleToActiveDocuments({
      organizationId,
      templateId: tpl.id,
      journalCode: tpl.code,
      positionIds: positionsByTemplate.get(tpl.id) ?? [],
      slotUsers: slots,
      // active-any — обновляем все active документы независимо от того
      // покрывают ли они «сегодня» (yearly-документы могут начинаться
      // 1 января, и при scope=active-today они бы не обновились).
      scope: "active-any",
    });
    documentsUpdated += cascade.documentsUpdated;
  }

  const afterCount = await db.journalDocument.count({
    where: { organizationId, status: "active", verifierUserId: null },
  });

  await db.auditLog.create({
    data: {
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? session.user.email ?? null,
      action: "journal.backfill_verifiers",
      entity: "JournalDocument",
      entityId: organizationId,
      details: {
        documentsUpdated,
        verifiersBefore: beforeCount,
        verifiersAfter: afterCount,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    documentsUpdated,
    verifiersBefore: beforeCount,
    verifiersAfter: afterCount,
    fixed: Math.max(0, beforeCount - afterCount),
  });
}
