import { brandQrPng } from "@/lib/brand-qr";
import { proposalPromoUrl } from "@/lib/proposal/cta";
import { isProposalSphere } from "@/lib/proposal/spheres";
import { isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo/rules";
import { decodeRouteParam } from "@/lib/route-param";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PNG фирменного QR для письма с КП: `/api/kp/qr/<CODE>?s=<сфера>`.
 *
 * Почтовые программы не показывают `data:`-картинки (Gmail их режет),
 * поэтому QR — по абсолютному адресу сайта. Маршрут рисует ТОЛЬКО адрес
 * `https://wesetup.ru/promo/<CODE>?s=<сфера>` (контракт promo-personal):
 * код проверяется по формату промокодов, сфера — по списку сфер. Никакого
 * произвольного текста — это не открытый генератор QR.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizePromoCode(decodeRouteParam(raw).replace(/\.png$/i, ""));
  const sphere = new URL(request.url).searchParams.get("s");
  if (!isValidPromoCodeFormat(code) || (sphere !== null && !isProposalSphere(sphere))) {
    console.warn(`[kp] qr png rejected code-format=${isValidPromoCodeFormat(code) ? "ok" : "bad"} sphere=${sphere ?? "-"}`);
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const url = proposalPromoUrl(code, sphere !== null && isProposalSphere(sphere) ? sphere : null);
  const png = await brandQrPng(url, { width: 600 });
  console.info(`[kp] qr png code=${code} sphere=${sphere ?? "-"} bytes=${png.length}`);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // Картинка зависит только от адреса — кэш почтовых прокси и браузера навсегда.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
