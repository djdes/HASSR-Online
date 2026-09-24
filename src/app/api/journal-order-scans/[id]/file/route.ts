import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
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
  const scan = await db.journalOrderScan.findFirst({
    where: { id, organizationId: getActiveOrgId(session) },
    select: { id: true, journalCode: true, title: true, mimeType: true, content: true },
  });
  if (!scan || !(await canViewOrderScans(session.user, scan.journalCode))) {
    return new Response("Не найдено", { status: 404 });
  }
  return orderScanFileResponse(scan, new URL(request.url).searchParams.get("download") === "1");
}
