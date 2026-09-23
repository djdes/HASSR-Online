import QRCode from "qrcode";

import type { QrMatrix } from "./qr-sticker";

/**
 * Матрица QR для наклеек лендинга — на сервере. Соседние тёмные модули
 * склеиваются в горизонтальные полосы, чтобы `d` был короче.
 */
export function buildQrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let d = "";
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < size && data[y * size + x + run]) run += 1;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size, d };
}
