import { NextResponse } from "next/server";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { isCommissionJournalCode } from "@/lib/brakerage-commission";
import { readOrgCommission, saveOrgCommission } from "@/lib/brakerage-commission-org";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { COMMISSION_CATEGORY_KEY, ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/**
 * «Сторонняя бракеражная комиссия» журнала.
 *   GET — состав + кандидаты (сотрудники организации по группам
 *         «Комиссия / Руководство / Сотрудники», у каждого — задан ли ПИН);
 *   PUT { members: [{ employeeId, role }] } — сохранить состав организации и
 *         скопировать его в активные документы журнала.
 */
async function guard(ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) } as const;
  const { code } = await ctx.params;
  if (!isCommissionJournalCode(code)) {
    return { error: NextResponse.json({ error: "Сторонняя комиссия есть только у бракеража готовой продукции" }, { status: 400 }) } as const;
  }
  return { session, code, organizationId: getActiveOrgId(session) } as const;
}

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await guard(ctx);
  if ("error" in auth) return auth.error;
  const [members, users] = await Promise.all([
    readOrgCommission(auth.organizationId, auth.code),
    db.user.findMany({
      where: { organizationId: auth.organizationId, ...ORG_SIGNER_WHERE },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        qrPinHash: true,
        jobPosition: { select: { name: true, categoryKey: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const candidates = users
    .filter((user) => user.name && !user.name.includes("@"))
    .map((user) => ({
      id: user.id,
      name: user.name,
      position: user.jobPosition?.name ?? user.positionTitle ?? "",
      group:
        user.jobPosition?.categoryKey === COMMISSION_CATEGORY_KEY
          ? ("commission" as const)
          : user.jobPosition?.categoryKey === "management" || (!user.jobPosition && isManagementRole(user.role))
            ? ("management" as const)
            : ("staff" as const),
      hasPin: Boolean(user.qrPinHash),
    }));
  return NextResponse.json({
    members,
    candidates,
    canManage: hasFullWorkspaceAccess(auth.session.user),
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  const auth = await guard(ctx);
  if ("error" in auth) return auth.error;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Состав комиссии меняет руководитель" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { members?: unknown } | null;
  const raw = Array.isArray(body?.members) ? body.members : [];
  const input = raw
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .map((item) => ({
      employeeId: typeof item.employeeId === "string" ? item.employeeId : "",
      role: typeof item.role === "string" ? item.role.slice(0, 80) : undefined,
    }))
    .filter((item) => item.employeeId);
  const result = await saveOrgCommission(auth.organizationId, auth.code, input);
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "journal.commission_update",
    entity: "Organization",
    entityId: auth.organizationId,
    details: { code: auth.code, members: result.members.map((member) => `${member.role}: ${member.employeeName}`) },
  });
  return NextResponse.json(result);
}
