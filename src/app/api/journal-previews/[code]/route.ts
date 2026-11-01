import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canSeeDocumentPoint } from "@/lib/document-point-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Content-Type по сигнатуре файла: с 2026-09-07 крон пишет WebP
 * (`journal-preview/render.ts`), но в колонке `png` ещё лежат снимки
 * прежнего формата — они доживают до ближайшей перерисовки, и отдавать
 * их как `image/webp` нельзя.
 */
function sniffImageType(bytes: Uint8Array): string {
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

/**
 * GET /api/journal-previews/<code>?v=<renderedAt> — снимок журнала
 * текущей организации (WebP; у старых строк ещё PNG). Только своя
 * организация: снимок — это реальные записи с фамилиями сотрудников.
 * Кэш браузера навсегда: версия в URL меняется вместе с перерисовкой.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(null, { status: 401 });
  }
  const { code } = await params;
  const organizationId = getActiveOrgId(session);

  // Точки: `b` — ключ точки из URL превью; без своего снимка отдаём общий.
  const requestedKey = new URL(request.url).searchParams.get("b") ?? "";
  // Снимок чужой точки (реальные записи с фамилиями) не отдаём — вместо
  // него общий (2026-11-01).
  const buildingKey = requestedKey && (await canSeeDocumentPoint(session, requestedKey)) ? requestedKey : "";
  const preview =
    (await db.journalPreview.findUnique({
      where: { organizationId_code_buildingKey: { organizationId, code, buildingKey } },
      select: { png: true, renderedAt: true },
    })) ??
    (buildingKey
      ? await db.journalPreview.findUnique({
          where: { organizationId_code_buildingKey: { organizationId, code, buildingKey: "" } },
          select: { png: true, renderedAt: true },
        })
      : null);
  if (!preview) {
    return new Response(null, { status: 404 });
  }

  const bytes = new Uint8Array(preview.png);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": sniffImageType(bytes),
      "Content-Length": String(preview.png.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "Last-Modified": preview.renderedAt.toUTCString(),
    },
  });
}
