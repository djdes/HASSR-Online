import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { defaultChecklistFor } from "@/lib/checklist-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Фаза «Документы» начальной настройки — чек-листы.
 *
 * POST { action: "fill-defaults", code } — вставить типовые пункты
 *   (`CHECKLIST_DEFAULTS`) в общий чек-лист журнала. Только если общих
 *   пунктов у журнала ещё нет: кнопка «Заполнить типовыми» не должна
 *   дублировать то, что руководитель уже настроил руками. Пункты уборки,
 *   привязанные к помещениям (roomId), не считаются — они живут своей
 *   синхронизацией.
 * POST { action: "mark-reviewed" } — отметка «Чек-листы проверены»
 *   (`Organization.checklistsReviewedAt`), закрывает фазу вместе с
 *   приказами.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fill-defaults"), code: z.string().min(1).max(80) }),
  z.object({ action: z.literal("mark-reviewed") }),
]);

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Нет прав" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Неверный формат запроса" },
      { status: 400 },
    );
  }

  if (parsed.data.action === "mark-reviewed") {
    const reviewedAt = new Date();
    await db.organization.update({
      where: { id: organizationId },
      data: { checklistsReviewedAt: reviewedAt },
    });
    await recordAuditLog({
      request,
      session,
      organizationId,
      action: "onboarding.checklists_reviewed",
      entity: "Organization",
      entityId: organizationId,
      details: { reviewedAt: reviewedAt.toISOString() },
    });
    return NextResponse.json({ ok: true, reviewedAt: reviewedAt.toISOString() });
  }

  const { code } = parsed.data;
  const defaults = defaultChecklistFor(code);
  if (defaults.length === 0) {
    return NextResponse.json(
      { error: "Для этого журнала нет типового чек-листа" },
      { status: 404 },
    );
  }

  // Проверка и вставка — в одной транзакции, чтобы двойной клик не
  // вставил набор дважды.
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.journalChecklistItem.count({
      where: { organizationId, journalCode: code, archivedAt: null, roomId: null },
    });
    if (existing > 0) return { created: 0, existing };
    await tx.journalChecklistItem.createMany({
      data: defaults.map((item, index) => ({
        organizationId,
        journalCode: code,
        roomId: null,
        label: item.title,
        hint: item.hint ?? null,
        required: item.required,
        frequency: item.frequency,
        weekDays: item.frequency === "weekly" ? (item.weekDays ?? []) : [],
        monthDay: item.frequency === "monthly" ? (item.monthDay ?? 1) : null,
        sortOrder: index,
        createdByUserId: session.user.id,
      })),
    });
    return { created: defaults.length, existing: 0 };
  });

  if (result.created === 0) {
    return NextResponse.json(
      {
        error: `В чек-листе уже есть пункты (${result.existing}) — откройте редактор, чтобы изменить их`,
        existing: result.existing,
      },
      { status: 409 },
    );
  }

  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "checklist.fill_defaults",
    entity: "JournalChecklistItem",
    entityId: code,
    details: { journalCode: code, created: result.created, source: "onboarding" },
  });

  return NextResponse.json({ ok: true, created: result.created });
}
