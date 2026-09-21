import { NextResponse } from "next/server";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { signBrakerageRows, type BrakerageSignEntry } from "@/lib/brakerage-signatures";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/journal-documents/[id]/sign — член бракеражной комиссии,
 * вошедший на сайт или в Mini App, подписывает выбранные строки своей
 * подписью (метод «вход в кабинет»). За другого подписать нельзя: подпись
 * ставится от пользователя сессии, и он обязан быть в составе комиссии.
 *
 * Тело: { entries: [{ rowId, grade?, releaseAllowed?, portionWeight?, note? }] }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id } = await params;
  const organizationId = getActiveOrgId(session);
  const body = (await request.json().catch(() => null)) as { entries?: unknown } | null;
  const entries: BrakerageSignEntry[] = (Array.isArray(body?.entries) ? body.entries : [])
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .filter((item) => typeof item.rowId === "string" && item.rowId)
    .slice(0, 200)
    .map((item) => ({
      rowId: String(item.rowId),
      ...(typeof item.grade === "string" && item.grade.trim() ? { grade: item.grade.trim().slice(0, 80) } : {}),
      ...(item.releaseAllowed === "yes" || item.releaseAllowed === "no" ? { releaseAllowed: item.releaseAllowed } : {}),
      ...(typeof item.portionWeight === "string" ? { portionWeight: item.portionWeight.slice(0, 20) } : {}),
      ...(typeof item.note === "string" ? { note: item.note.slice(0, 500) } : {}),
    }));
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const signer = await db.user.findFirst({
    where: { id: session.user.id, organizationId },
    select: { id: true, name: true },
  });
  if (!signer) return NextResponse.json({ error: "Подписывают только члены комиссии этого журнала" }, { status: 403 });
  const result = await signBrakerageRows({
    documentId: id,
    organizationId,
    signer,
    method: "session",
    entries,
    timeZone: org?.timezone,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "journal.brakerage_sign",
    entity: "JournalDocument",
    entityId: id,
    details: { rows: entries.map((entry) => entry.rowId), method: "session" },
  });
  const document = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
  return NextResponse.json({ signed: result.signed, config: document?.config ?? null });
}
