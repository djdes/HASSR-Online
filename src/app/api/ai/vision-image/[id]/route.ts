import { verifyVisionImageLink } from "@/lib/ai-vision/image-link";
import { readVisionImage } from "@/lib/ai-vision/temp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/vision-image/<id>?exp=<мс>&sig=<HMAC> — фото для воркера
 * распознавания (`dispatcher/wesetup-worker.ps1`).
 *
 * Без сессии: доступ даёт только действующая подпись сервера и срок
 * (15 минут). Неверная подпись — 403, истёкшая — 410, файла уже нет — 404.
 * Никакого кэша: ссылка одноразовая по смыслу.
 */

function deny(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const verdict = verifyVisionImageLink({ id, exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig") });
  if (!verdict.ok) {
    console.warn(`[ai-vision] image denied reason=${verdict.reason}`);
    if (verdict.reason === "bad_id") return deny(404, "Not found");
    if (verdict.reason === "expired") return deny(410, "Link expired");
    return deny(403, "Forbidden");
  }
  const file = await readVisionImage(id);
  if (!file) return deny(404, "Not found");
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.bytes.length),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
