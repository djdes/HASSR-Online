import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { cascadeResponsibleToActiveDocuments } from "@/lib/journal-responsibles-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/journal-responsibles/resync-all
 *
 * Каскад сохранённых responsibles из Organization.journalResponsibleUsersJson
 * во ВСЕ активные документы орги. Используется один раз после релиза,
 * чтобы старые документы (созданные до prefill) тоже подхватили
 * назначенных ФИО — без этого «отправить всем» молча пропускает их
 * с reason'ом «не указан ответственный сотрудник».
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);

  // Достаём все активные templates + текущие positionAccess по орге.
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

  let documentsUpdated = 0;
  let journalsProcessed = 0;
  for (const tpl of templates) {
    const cascade = await cascadeResponsibleToActiveDocuments({
      organizationId,
      templateId: tpl.id,
      journalCode: tpl.code,
      positionIds: positionsByTemplate.get(tpl.id) ?? [],
      slotUsers: orgSlots[tpl.code],
    });
    documentsUpdated += cascade.documentsUpdated;
    journalsProcessed += 1;
  }

  return NextResponse.json({
    ok: true,
    journalsProcessed,
    documentsUpdated,
  });
}
