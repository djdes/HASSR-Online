import { buildProposalContent } from "@/lib/proposal/content";
import { loadProposalContext } from "@/lib/proposal/context.server";
import { renderProposalPdfDocument } from "@/lib/proposal/pdf";
import { verifyProposalToken } from "@/lib/proposal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF веб-версии КП: `/kp/<токен>/pdf` — в браузере, `?download=1` — файлом.
 * Токен тот же, что у страницы; цены — на момент скачивания.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = verifyProposalToken(token);
  if (!check.ok) {
    console.warn(`[kp] pdf rejected reason=${check.reason}`);
    return new Response("Ссылка на предложение недействительна", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const started = Date.now();
  const content = buildProposalContent(check.vars, await loadProposalContext());
  const render = renderProposalPdfDocument(content);
  const download = new URL(request.url).searchParams.get("download") === "1";
  console.info(
    `[kp] pdf served sphere=${content.sphere} promo=${content.offer.promoCode ?? "-"} download=${download ? "yes" : "no"} bytes=${render.buffer.length} ms=${Date.now() - started}`,
  );
  const ascii = `WeSetup-KP-${content.sphere}.pdf`;
  // «КП WeSetup — Кафе «Ромашка».pdf»; без компании — сфера («Кафе, Кофейня»).
  const title = (content.companyName ?? content.sphereLabel).replace(/\s*\/\s*/g, ", ").replace(/[\\/:*?"<>|]/g, " ").trim();
  const utf8 = `КП WeSetup — ${title}.pdf`;
  return new Response(new Uint8Array(render.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utf8)}`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
