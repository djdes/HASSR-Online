import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { loadInspectorsAuditors, loadInspectorsAuditorsScope } from "@/lib/inspectors-auditors.server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/inspectors-auditors — общий список «Проверяющие и аудиторы».
 *
 *   external[] — ссылки и QR портала проверяющего: kind ("qr" | "link"),
 *                label, период, expiresAt, status ("active" | "expired" |
 *                "revoked"), issuedBy, accessCount, lastAccessedAt, visits[];
 *                хэш токена не отдаётся;
 *   internal[] — сотрудники и их роли проверки (журналы, документы,
 *                помещения, аудиты, прослеживаемость) — см.
 *                src/lib/inspectors-auditors.ts.
 *
 * Сборка — `loadInspectorsAuditors` (её же читает страница
 * `/settings/inspectors`).
 *
 * Доступ: руководитель. Точка видит только своё (2026-11-01): руководителю
 * точки — его точки, точка в шапке — её (`loadInspectorsAuditorsScope`).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const scope = await loadInspectorsAuditorsScope(session);
  const { external, internal, totals } = await loadInspectorsAuditors(getActiveOrgId(session), scope);
  return NextResponse.json({ external, internal, totals });
}
