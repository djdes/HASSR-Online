import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { invalidateJournalAcl } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { decidePresetChange } from "@/lib/staff-preset-change";
import { recordAuditLog } from "@/lib/audit-log";
import { staffOutOfScopeResponse } from "@/lib/point-scope.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/[id]/preset
 *   body: { preset: <один из ALL_PRESETS> | null }
 *
 * Набор прав сотрудника: `null` — «по должности (автоматически)».
 * Менять может только администратор (`admin.full`); себе нельзя
 * поставить набор без «Администратора» (защита от самоблокировки,
 * src/lib/staff-preset-change.ts). После смены сбрасывается кэш ACL
 * журналов человека: контроль-группа и обратно меняют право записи.
 */
const bodySchema = z.object({
  preset: z.string().max(40).nullable(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Набор прав меняет администратор" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const outOfScope = await staffOutOfScopeResponse(session, id);
  if (outOfScope) return outOfScope;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, organizationId: true, role: true, isRoot: true, permissionPreset: true },
  });
  if (!user || user.organizationId !== organizationId) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const decision = decidePresetChange({ actor: session.user, target: user, preset: body.preset });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error, code: decision.code }, { status: decision.status });
  }

  if (decision.changed) {
    await db.user.update({
      where: { id },
      data: { permissionPreset: decision.preset },
    });
    await recordAuditLog({
      request,
      session,
      organizationId,
      action: "staff.preset_change",
      entity: "User",
      entityId: id,
      details: { employee: user.name, from: user.permissionPreset ?? null, to: decision.preset },
    });
  }
  // Право записи в журналы зависит от пресета (контроль-группа) — без
  // сброса кэш ACL отдавал бы прежнее решение до минуты.
  invalidateJournalAcl(id);

  return NextResponse.json({
    ok: true,
    permissionPreset: decision.preset,
    effectivePreset: decision.effective,
    changed: decision.changed,
  });
}
