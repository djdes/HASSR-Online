import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ORDER_SCAN_ERRORS, normalizeOrderScanTitle } from "@/lib/journal-order-scans";
import { canManageOrderScans, writeOrderScanAudit } from "@/lib/journal-order-scans-db";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Переименовать (PATCH { title }) и удалить (DELETE) скан приказа к журналу. */

async function loadOwned(id: string, organizationId: string) {
  return db.journalOrderScan.findFirst({
    where: { id, organizationId },
    select: { id: true, title: true, journalCode: true, fileName: true },
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!canManageOrderScans(session.user)) {
    return NextResponse.json({ error: "Переименовывать приказы может руководство" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const scan = await loadOwned(id, organizationId);
  if (!scan) return NextResponse.json({ error: "Приказ не найден" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  const title = normalizeOrderScanTitle(body?.title);
  if (!title) return NextResponse.json({ error: ORDER_SCAN_ERRORS.title }, { status: 400 });

  const updated = await db.journalOrderScan.update({
    where: { id: scan.id },
    data: { title },
    select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedByName: true },
  });
  await writeOrderScanAudit({
    organizationId,
    userId: session.user.id,
    userName: session.user.name ?? null,
    action: "journal_order_scan.rename",
    scanId: scan.id,
    details: { journalCode: scan.journalCode, from: scan.title, to: title },
  });
  console.info("[order-scans] renamed", { organizationId, id: scan.id, code: scan.journalCode });
  return NextResponse.json({ scan: { ...updated, createdAt: updated.createdAt.toISOString() } });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!canManageOrderScans(session.user)) {
    return NextResponse.json({ error: "Удалять приказы может руководство" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const scan = await loadOwned(id, organizationId);
  if (!scan) return NextResponse.json({ error: "Приказ не найден" }, { status: 404 });

  await db.journalOrderScan.delete({ where: { id: scan.id } });
  await writeOrderScanAudit({
    organizationId,
    userId: session.user.id,
    userName: session.user.name ?? null,
    action: "journal_order_scan.delete",
    scanId: scan.id,
    details: { journalCode: scan.journalCode, title: scan.title, fileName: scan.fileName },
  });
  console.info("[order-scans] deleted", { organizationId, id: scan.id, code: scan.journalCode });
  return NextResponse.json({ deleted: 1 });
}
