import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { loadClosingDocument, refreshClosingDocumentBuyer } from "@/lib/closing-documents/service";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { isPointScoped } from "@/lib/point-scope";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — перезаписать покупателя в снимке документа из текущего профиля
 * организации. Нужно тем, кто добавил ИНН уже после оплаты: строки и
 * суммы не трогаются, только сторона покупателя.
 */
export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { orderId: raw } = await ctx.params;
  const orderId = Number.parseInt(raw, 10);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const existing = await loadClosingDocument(orderId);
  if (!existing) return NextResponse.json({ error: "Документ ещё не выпущен" }, { status: 404 });
  const organizationId = getActiveOrgId(session);
  const own = existing.organizationId === organizationId && hasFullWorkspaceAccess(session.user) &&
    // УПД — документ компании: руководителю точки закрыт (2026-11-01).
    !isPointScoped(session.user);
  if (!own && !session.user.isRoot) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const updated = await refreshClosingDocumentBuyer(orderId);
  await recordAuditLog({
    organizationId: existing.organizationId ?? organizationId,
    session,
    request,
    action: "closing-document.refresh-buyer",
    entity: "ClosingDocument",
    entityId: existing.id,
    details: { orderId, buyer: updated?.buyer ?? null },
  });
  return NextResponse.json({ ok: true, buyer: updated?.buyer ?? null });
}
