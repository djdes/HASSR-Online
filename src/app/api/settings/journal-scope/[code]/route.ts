import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/journal-scope/[code]
 *   Возвращает текущие taskScope/allowNoEvents/noEventsReasons/
 *   allowFreeTextReason для шаблона. Только management.
 *
 * PATCH /api/settings/journal-scope/[code]
 *   Body: { taskScope?, allowNoEvents?, noEventsReasons?, allowFreeTextReason? }
 *   Обновляет любое подмножество полей. Только management.
 *
 * Note: значения шаблона глобальные (не per-org): `JournalTemplate`
 * один на всю платформу. Поэтому менять их может только ROOT —
 * раньше руководитель одной компании менял поведение задач у всех.
 * Своё значение на организацию требует поля в схеме
 * (например `Organization.journalScopeJson`), пока его нет.
 */
const GLOBAL_SCOPE_FORBIDDEN_MESSAGE =
  "Эти настройки общие для всех компаний, их меняет администратор платформы";

const patchSchema = z.object({
  taskScope: z.enum(["personal", "shared"]).optional(),
  allowNoEvents: z.boolean().optional(),
  noEventsReasons: z.array(z.string().min(1).max(120)).max(20).optional(),
  allowFreeTextReason: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { code } = await ctx.params;
  const template = await db.journalTemplate.findFirst({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      taskScope: true,
      allowNoEvents: true,
      noEventsReasons: true,
      allowFreeTextReason: true,
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  return NextResponse.json({ template });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  if (auth.session.user.isRoot !== true) {
    return NextResponse.json({ error: GLOBAL_SCOPE_FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const { code } = await ctx.params;
  let parsed;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad body" },
        { status: 400 }
      );
    }
    throw err;
  }

  const template = await db.journalTemplate.findFirst({
    where: { code },
    select: {
      id: true,
      taskScope: true,
      allowNoEvents: true,
      noEventsReasons: true,
      allowFreeTextReason: true,
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.taskScope !== undefined) data.taskScope = parsed.taskScope;
  if (parsed.allowNoEvents !== undefined)
    data.allowNoEvents = parsed.allowNoEvents;
  if (parsed.noEventsReasons !== undefined)
    data.noEventsReasons = parsed.noEventsReasons;
  if (parsed.allowFreeTextReason !== undefined)
    data.allowFreeTextReason = parsed.allowFreeTextReason;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Нет полей для обновления" },
      { status: 400 }
    );
  }

  const updated = await db.journalTemplate.update({
    where: { id: template.id },
    data,
    select: {
      taskScope: true,
      allowNoEvents: true,
      noEventsReasons: true,
      allowFreeTextReason: true,
    },
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: getActiveOrgId(auth.session),
    action: "settings.journal_scope.update",
    entity: "journal_template",
    entityId: template.id,
    details: {
      journalCode: code,
      before: {
        taskScope: template.taskScope,
        allowNoEvents: template.allowNoEvents,
        noEventsReasons: template.noEventsReasons,
        allowFreeTextReason: template.allowFreeTextReason,
      },
      after: updated,
    },
  });
  return NextResponse.json({ ok: true, ...updated });
}
