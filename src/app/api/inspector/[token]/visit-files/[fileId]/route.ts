import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorViewLimiter,
  loadInspectorAccess,
  logInspectorEvent,
} from "@/lib/inspector-access";
import { inspectionVisitFileAccessible } from "@/lib/inspection-visits";
import { inspectionVisitIdsFromHeaders } from "@/lib/inspection-visit-cookie";
import {
  findInspectionVisitFile,
  inspectionVisitFileResponse,
  inspectionVisitNotFound,
} from "@/lib/inspection-visits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Вложение посещения для проверяющего: только записи, внесённые этим же
 * токеном и этим браузером (cookie), не скрытые, и только пока токен
 * действует. Неизвестный, отозванный или истёкший токен, чужой файл, чужая
 * организация, нет cookie — один и тот же 404 без подсказки (AC3).
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status !== "ok") return inspectionVisitNotFound();
  const key = inspectorLimitKey(access.token.id, inspectorClientIp(request.headers));
  if (!inspectorViewLimiter.consume(key)) {
    const retry = Math.max(1, Math.ceil(inspectorViewLimiter.remainingMs(key) / 1000));
    return new Response("Слишком много запросов. Повторите через минуту.", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(retry) },
    });
  }
  const file = await findInspectionVisitFile(fileId);
  const allowed = inspectionVisitFileAccessible({
    file,
    viewer: {
      kind: "token",
      organizationId: access.token.organizationId,
      tokenId: access.token.id,
      active: true,
      // Только записи, внесённые этим браузером (подписанная cookie).
      visitIds: inspectionVisitIdsFromHeaders(request.headers, access.token.id),
    },
  });
  if (!file || !allowed) return inspectionVisitNotFound();
  await logInspectorEvent({
    access,
    headers: request.headers,
    action: "inspector.download",
    viewer: null,
    details: { kind: "visit_file", fileId: file.id },
  });
  return inspectionVisitFileResponse(file, new URL(request.url).searchParams.get("download") === "1");
}
