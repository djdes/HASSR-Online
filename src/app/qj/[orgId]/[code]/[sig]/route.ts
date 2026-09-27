import { resolveJournalShortQr } from "@/lib/journal-pdf-qr-link";
import { relativeRedirect } from "@/lib/relative-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/qj/<orgId>/<code>/<sig>` — QR в шапке печатного журнала.
 *
 * Подпись сходится → на основной QR этого журнала (`/journal-fill/...` с
 * токеном, запись по PIN). Не сходится → 404 без подробностей: не
 * подсказываем, что именно неверно (организация, журнал или подпись).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ orgId: string; code: string; sig: string }> },
) {
  const { orgId, code, sig } = await ctx.params;
  let target: string | null = null;
  try {
    target = resolveJournalShortQr(orgId, code, sig);
  } catch (error) {
    console.error("[qj] short journal QR failed", error);
    return new Response("Не удалось открыть журнал", { status: 500 });
  }
  if (!target) {
    console.warn("[qj] bad signature", { orgId: orgId.slice(0, 32), code: code.slice(0, 64) });
    return new Response("Ссылка недействительна", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const response = relativeRedirect(target, 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
