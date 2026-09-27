/**
 * Разбор промаха jsQR («ч/б + телефон», 300 dpi): что в новой плитке мешает.
 * Лист 600 dpi «как принтер» → правка растра (стереть полосу / знак / линии
 * ячейки) → тот же «телефон» (поворот, перспектива 4 %, σ 0,6, JPEG 90) по
 * набору углов → jsQR и zxing-cpp.
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-bwqr node --import tsx \
 *     .agent/tasks/qr-bw-minimal-2026-09/ablation.ts <набор:метка:стр> ...
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import { brandQrLayout } from "@/lib/brand-qr";
import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { PHONE, decodeJsQr, decodeZxing, openPdf, pageSizeMm, phoneCapture, renderRegion, threshold, type Raster } from "../journal-qr-header-2026-09/qr-sim";

const ANGLES = [5, 6, 7, 8, 9, 10, -5, -6, -7, -8, -9, -10];

function paint(r: Raster, origin: { x: number; y: number }, box: { x0: number; y0: number; x1: number; y1: number }, value: number): Raster {
  const k = 600 / 25.4;
  const data = new Uint8ClampedArray(r.data);
  const x0 = Math.max(0, Math.round((box.x0 - origin.x) * k));
  const x1 = Math.min(r.width, Math.round((box.x1 - origin.x) * k));
  const y0 = Math.max(0, Math.round((box.y0 - origin.y) * k));
  const y1 = Math.min(r.height, Math.round((box.y1 - origin.y) * k));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * r.width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
  }
  return { width: r.width, height: r.height, data };
}

async function main() {
  const specs = process.argv.slice(2);
  const cases = buildCases(null);
  for (const spec of specs) {
    const [set, label, pageArg] = spec.split(":");
    const item = cases.find((c) => c.set === set && c.label === label)!;
    const rendered = item.render("stamp");
    const p = (rendered.qrPlacements as JournalQrPlacement[]).find((q) => q.page === Number(pageArg ?? 1))!;
    const doc = await openPdf(rendered.buffer);
    const size = await pageSizeMm(doc, p.page);
    const grid = 25.4 / 150;
    const snap = (v: number, up = false) => (up ? Math.ceil(v / grid - 1e-6) : Math.floor(v / grid + 1e-6)) * grid;
    const box = {
      x0: snap(Math.max(0, p.box!.x0 - 14)),
      y0: snap(Math.max(0, p.box!.y0 - 8)),
      x1: snap(Math.min(size.width, p.box!.x1 + 8), true),
      y1: snap(Math.min(size.height, p.box!.y1 + 8), true),
    };
    const master = await renderRegion(doc, p.page, box, 600);
    await doc.close();
    const origin = { x: box.x0, y: box.y0 };
    const layout = brandQrLayout(item.url);
    const u = p.module;
    const win = p.window!;
    const strip = { x0: p.box!.x0 - 0.2, y0: win.y1 + (p.box!.y1 - (layout.strip!.h * u) - win.y1), x1: p.box!.x1 + 0.2, y1: p.box!.y1 + 0.2 };
    const pad = layout.pad;
    const mark = {
      x0: win.x0 + (pad.x - layout.window.x) * u,
      y0: win.y0 + (pad.y - layout.window.y) * u,
      x1: win.x0 + (pad.x - layout.window.x + pad.w) * u,
      y1: win.y0 + (pad.y - layout.window.y + pad.h) * u,
    };
    const variants: Record<string, Raster> = {
      "как есть": master,
      "без полосы": paint(master, origin, strip, 255),
      "без знака": paint(master, origin, mark, 255),
      "без линий ячейки (бок)": paint(paint(master, origin, { x0: p.box!.x0 - 0.35, y0: p.box!.y0 - 0.35, x1: p.box!.x0 + 0.02, y1: p.box!.y1 + 0.35 }, 255), origin, { x0: p.box!.x1 - 0.02, y0: p.box!.y0 - 0.35, x1: p.box!.x1 + 0.35, y1: p.box!.y1 + 0.35 }, 255),
    };
    console.log(`${set}:${label} стр. ${p.page} n=${p.modules} m=${u.toFixed(3)}`);
    for (const [name, raster] of Object.entries(variants)) {
      const bw = threshold(raster);
      let jp = 0;
      let jb = 0;
      let zp = 0;
      let zb = 0;
      const missed: string[] = [];
      for (const angle of ANGLES) {
        const phone = await phoneCapture(raster, 600, 300, { ...PHONE, angle });
        const bwPhone = await phoneCapture(bw, 600, 300, { ...PHONE, angle });
        if (decodeJsQr(phone) === item.url) jp += 1;
        else missed.push(`phone ${angle}°`);
        if (decodeJsQr(bwPhone) === item.url) jb += 1;
        else missed.push(`bw-phone ${angle}°`);
        if ((await decodeZxing(phone)) === item.url) zp += 1;
        if ((await decodeZxing(bwPhone)) === item.url) zb += 1;
      }
      console.log(`  ${name.padEnd(24)} jsQR телефон ${jp}/12, ч/б+телефон ${jb}/12 | zxing ${zp}/12, ${zb}/12 ${missed.length ? `— jsQR мимо: ${missed.join(", ")}` : ""}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
