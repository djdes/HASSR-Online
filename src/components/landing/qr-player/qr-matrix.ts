import { brandQrSvg } from "@/lib/brand-qr";

import type { QrMatrix } from "./qr-sticker";

/** SVG тянется по ширине родителя (у помощника — фиксированные px). */
function fluid(svg: string): string {
  return svg.replace(/ width="\d+" height="\d+"/, ' style="display:block;width:100%;height:auto"');
}

/**
 * Фирменный QR для наклеек лендинга (`brand-qr.ts`) — собирается на
 * сервере: пакет `qrcode` в клиентский бандл не попадает. Два вида:
 * золотой наклейке подпись даёт её рамка, а наклейка в ролике — как её
 * печатает продукт, с полосой «Отсканировать».
 */
export async function buildQrMatrix(text: string): Promise<QrMatrix> {
  const [bare, printed] = await Promise.all([brandQrSvg(text, { caption: false }), brandQrSvg(text)]);
  return { bare: fluid(bare), printed: fluid(printed) };
}
