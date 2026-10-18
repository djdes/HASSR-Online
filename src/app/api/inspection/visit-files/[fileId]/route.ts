import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { inspectionVisitFileAccessible, canUseInspectionVisits } from "@/lib/inspection-visits";
import {
  findInspectionVisitFile,
  inspectionVisitFileResponse,
  inspectionVisitNotFound,
} from "@/lib/inspection-visits.server";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Скан основания проверки в кабинете: только своей организации и тем, кто
 * видит журнал посещений. Без сессии, чужая организация, повар — 404 (не
 * подсказываем, что файл есть). `?download=1` — скачать.
 */
export async function GET(request: Request, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return inspectionVisitNotFound();
  const organizationId = getActiveOrgId(session);
  const file = await findInspectionVisitFile(fileId);
  const allowed = inspectionVisitFileAccessible({
    file,
    viewer: { kind: "cabinet", organizationId, allowed: canUseInspectionVisits(session.user) },
  });
  if (!file || !allowed) {
    if (file) console.warn("[inspection-visits] file access denied", { fileId, organizationId, userId: session.user.id });
    return inspectionVisitNotFound();
  }
  return inspectionVisitFileResponse(file, new URL(request.url).searchParams.get("download") === "1");
}
