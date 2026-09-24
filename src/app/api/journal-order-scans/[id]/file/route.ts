import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { orderScanAccessible } from "@/lib/journal-order-scans";
import { canViewOrderScans } from "@/lib/journal-order-scans-db";
import { orderScanFileResponse } from "@/lib/journal-order-scans-http";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Файл скана приказа — только своей организации и тем, кому доступен
 * журнал. Без сессии и для чужой организации — 404 (не подсказываем, что
 * файл существует). `?download=1` — скачать вместо просмотра.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Не найдено", { status: 404 });
  const organizationId = getActiveOrgId(session);
  const scan = await db.journalOrderScan.findUnique({
    where: { id },
    select: { id: true, organizationId: true, journalCode: true, title: true, mimeType: true },
  });
  const journalReadable =
    scan && scan.organizationId === organizationId ? await canViewOrderScans(session.user, scan.journalCode) : false;
  if (!orderScanAccessible({ scan, organizationId, journalReadable })) {
    if (scan) console.warn("[order-scans] file access denied", { id, organizationId, userId: session.user.id });
    return new Response("Не найдено", { status: 404 });
  }
  const file = await db.journalOrderScan.findUnique({ where: { id }, select: { content: true } });
  if (!scan || !file) return new Response("Не найдено", { status: 404 });
  return orderScanFileResponse({ ...scan, content: file.content }, new URL(request.url).searchParams.get("download") === "1");
}
