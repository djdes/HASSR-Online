/**
 * Зависимость чтения от фазы сетки снимка (где границы модулей падают
 * относительно пикселей камеры/сканера). Печать — от края листа (600 dpi,
 * серый + порог, как ч/б принтер); снимок сдвигается на доли своего пикселя:
 * 150 dpi — 16 фаз (шаг ¼ px), 300 dpi — 4 фазы (шаг ½ px). Чистый снимок —
 * растр pdf.js со сдвигом кадра на те же доли. Итог — raw/phase-sweep.txt.
 *
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/phase-sweep.ts
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "./pages";
import { decodeJsQr, decodeZxing, openPdf, renderRegion, threshold, type Raster } from "./qr-sim";

/** Уменьшение в `factor` раз со сдвигом начала на (ox, oy) пикселей исходника. */
function downsampleAt(r: Raster, factor: number, ox: number, oy: number): Raster {
  const width = Math.floor((r.width - ox) / factor);
  const height = Math.floor((r.height - oy) / factor);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let s = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) s += r.data[((oy + y * factor + dy) * r.width + (ox + x * factor + dx)) * 4];
      }
      const o = (y * width + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = s / (factor * factor);
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

async function main() {
  const cases = buildCases(new Set(["samples", "blanks", "long"]));
  const pick: Array<[string, string]> = [
    ["samples", "hygiene"],
    ["samples", "cold_equipment_control"],
    ["samples", "incoming_raw_materials_control"],
    ["long", "hygiene"],
    ["long", "cleaning_ventilation_checklist"],
    ["blanks", "hygiene"],
  ];
  for (const [set, label] of pick) {
    const item = cases.find((c) => c.set === set && c.label === label)!;
    const rendered = item.render("stamp");
    const p = ((rendered.qrPlacements ?? []) as JournalQrPlacement[]).find((q) => q.box)!;
    const doc = await openPdf(rendered.buffer);
    const grid = 25.4 / 150;
    const box = {
      x0: Math.floor((p.box!.x0 - 14) / grid) * grid,
      y0: Math.floor(Math.max(0, p.box!.y0 - 8) / grid) * grid,
      x1: Math.ceil((p.box!.x1 + 8) / grid) * grid,
      y1: Math.ceil((p.box!.y1 + 8) / grid) * grid,
    };
    const printer = threshold(await renderRegion(doc, p.page, box, 600));
    const parts: string[] = [];
    for (const dpi of [150, 300]) {
      const factor = 600 / dpi;
      const stat = { clean: [0, 0, 0], bw: [0, 0, 0], print: [0, 0, 0] } as Record<string, number[]>;
      for (let oy = 0; oy < factor; oy += 1) {
        for (let ox = 0; ox < factor; ox += 1) {
          const shift = { x: (ox * 25.4) / 600, y: (oy * 25.4) / 600 };
          const clean = await renderRegion(
            doc,
            p.page,
            { x0: box.x0 + shift.x, y0: box.y0 + shift.y, x1: box.x1, y1: box.y1 },
            dpi,
            { snap: false },
          );
          const shots: Array<[string, Raster]> = [
            ["clean", clean],
            ["bw", threshold(clean)],
            ["print", downsampleAt(printer, factor, ox, oy)],
          ];
          for (const [kind, raster] of shots) {
            stat[kind][0] += 1;
            if (decodeJsQr(raster) === item.url) stat[kind][1] += 1;
            if ((await decodeZxing(raster)) === item.url) stat[kind][2] += 1;
          }
        }
      }
      parts.push(
        `${dpi} dpi: ` +
          Object.entries(stat)
            .map(([k, [n, j, z]]) => `${k} jsQR ${j}/${n} zxing ${z}/${n}`)
            .join(", "),
      );
    }
    await doc.close();
    console.log(`${set}:${label} n=${p.modules} m=${p.module.toFixed(3)} | ${parts.join(" | ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
