import { db } from "@/lib/db";
import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorViewLimiter,
  loadInspectorAccess,
  logInspectorEvent,
  readInspectorViewer,
  inspectorViewerCookie,
} from "@/lib/inspector-access";
import { orderScanFileResponse } from "@/lib/journal-order-scans-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plain(status: number, message: string, extra?: Record<string, string>): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/**
 * Скан приказа к журналу для проверяющего (вход по токену из QR): только
 * организации токена и только включённого журнала, иначе 404.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status === "not_found") return plain(404, "Не найдено");
  if (access.status !== "ok") return plain(410, "Доступ отозван или истёк");
  const key = inspectorLimitKey(access.token.id, inspectorClientIp(request.headers));
  if (!inspectorViewLimiter.consume(key)) {
    const retry = Math.max(1, Math.ceil(inspectorViewLimiter.remainingMs(key) / 1000));
    return plain(429, "Слишком много запросов. Повторите через минуту.", { "Retry-After": String(retry) });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return plain(404, "Не найдено");
  const scan = await db.journalOrderScan.findFirst({
    where: { id, organizationId: access.token.organizationId },
    select: { id: true, journalCode: true, title: true, mimeType: true, content: true },
  });
  if (!scan || access.disabledCodes.has(scan.journalCode)) return plain(404, "Не найдено");

  const viewer = readInspectorViewer(cookieValue(request.headers.get("cookie"), inspectorViewerCookie(access.token.id)));
  await logInspectorEvent({
    access,
    headers: request.headers,
    action: "inspector.download",
    viewer,
    details: { kind: "journal_order_scan", code: scan.journalCode, scanId: scan.id, title: scan.title },
  });
  return orderScanFileResponse(scan);
}
