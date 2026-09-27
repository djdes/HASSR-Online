/**
 * Разброс «снимка телефоном» для QR в ячейке шапки: насколько jsQR мешают
 * боковые линии ячейки в 2 модулях от кода. Настоящие шапки (37–53 модуля),
 * 12 поворотов × 3 степени «телефона» × 2 фазы сетки, «телефон» и
 * «ч/б + телефон» при 300 dpi; варианты растра 600 dpi: как есть; внутренний
 * край боковых линий отодвинут на 0,05 / 0,1 / 0,15 мм (белое поле между кодом
 * и линией); боковых линий нет.
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-bwqr node --import tsx \
 *     .agent/tasks/qr-bw-minimal-2026-09/line-sweep.ts [набор:метка ...]
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { decodeJsQr, decodeZxing, openPdf, pageSizeMm, phoneCapture, renderRegion, threshold, type Raster } from "../journal-qr-header-2026-09/qr-sim";

const ANGLES = [5, 6, 7, 8, 9, 10, -5, -6, -7, -8, -9, -10];
const STRENGTHS = [
  { name: "лёгкий", keystone: 0.04, blur: 0.6, jpeg: 90 },
  { name: "средний", keystone: 0.06, blur: 0.7, jpeg: 85 },
  { name: "жёсткий", keystone: 0.08, blur: 0.8, jpeg: 85 },
];

function whiten(r: Raster, origin: { x: number; y: number }, boxes: Array<{ x0: number; y0: number; x1: number; y1: number }>): Raster {
  const k = 600 / 25.4;
  const data = new Uint8ClampedArray(r.data);
  for (const box of boxes) {
    const x0 = Math.max(0, Math.round((box.x0 - origin.x) * k));
    const x1 = Math.min(r.width, Math.round((box.x1 - origin.x) * k));
    const y0 = Math.max(0, Math.round((box.y0 - origin.y) * k));
    const y1 = Math.min(r.height, Math.round((box.y1 - origin.y) * k));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * r.width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }
  }
  return { width: r.width, height: r.height, data };
}

/** Сдвиг растра на dx пикселей вправо (фаза сетки относительно пикселей снимка). */
function shift(r: Raster, dx: number): Raster {
  if (!dx) return r;
  const data = new Uint8ClampedArray(r.data.length).fill(255);
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width - dx; x += 1) {
      const from = (y * r.width + x) * 4;
      const to = (y * r.width + x + dx) * 4;
      data[to] = r.data[from];
      data[to + 1] = r.data[from + 1];
      data[to + 2] = r.data[from + 2];
      data[to + 3] = 255;
    }
  }
  return { width: r.width, height: r.height, data };
}

async function main() {
  const picks = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["samples:hygiene", "samples:transport_temperature", "samples:cleaning_ventilation_checklist", "long:hygiene", "long:cleaning_ventilation_checklist"];
  const cases = buildCases(null);
  const totals = new Map<string, { j: number; z: number; n: number }>();
  for (const pick of picks) {
    const [set, label] = pick.split(":");
    const item = cases.find((c) => c.set === set && c.label === label)!;
    const rendered = item.render("stamp");
    const p = (rendered.qrPlacements as JournalQrPlacement[]).find((q) => q.where === "header")!;
    const doc = await openPdf(rendered.buffer);
    const size = await pageSizeMm(doc, p.page);
    const box = { x0: Math.max(0, p.box!.x0 - 12), y0: Math.max(0, p.box!.y0 - 6), x1: Math.min(size.width, p.box!.x1 + 8), y1: p.box!.y1 + 8 };
    const master = await renderRegion(doc, p.page, box, 600);
    await doc.close();
    const origin = { x: Math.floor(box.x0 * (600 / 25.4) + 1e-6) / (600 / 25.4), y: Math.floor(box.y0 * (600 / 25.4) + 1e-6) / (600 / 25.4) };
    // Боковые линии ячейки: оси — slot.x0 и slot.x1, толщина 0,2 мм; внутренний край — у box.
    const slot = p.slot!;
    const inner = (gap: number) => [
      { x0: slot.x0, y0: slot.y0 - 0.3, x1: slot.x0 + 0.1 + gap, y1: slot.y1 + 0.3 },
      { x0: slot.x1 - 0.1 - gap, y0: slot.y0 - 0.3, x1: slot.x1, y1: slot.y1 + 0.3 },
    ];
    const variants: Record<string, Raster> = {
      "как есть (0)": master,
      "поле 0,05 мм": whiten(master, origin, inner(0.05)),
      "поле 0,10 мм": whiten(master, origin, inner(0.1)),
      "поле 0,15 мм": whiten(master, origin, inner(0.15)),
      "без боковых линий": whiten(master, origin, [
        { x0: slot.x0 - 0.15, y0: slot.y0 - 0.3, x1: slot.x0 + 0.12, y1: slot.y1 + 0.3 },
        { x0: slot.x1 - 0.12, y0: slot.y0 - 0.3, x1: slot.x1 + 0.15, y1: slot.y1 + 0.3 },
      ]),
    };
    for (const [name, raster] of Object.entries(variants)) {
      let j = 0;
      let z = 0;
      let n = 0;
      for (const phase of [0, 1]) {
        const shifted = shift(raster, phase);
        const bw = threshold(shifted);
        for (const s of STRENGTHS) {
          for (const angle of ANGLES) {
            for (const src of [shifted, bw]) {
              const shot = await phoneCapture(src, 600, 300, { angle, keystone: s.keystone, blur: s.blur, jpeg: s.jpeg });
              n += 1;
              if (decodeJsQr(shot) === item.url) j += 1;
              if ((await decodeZxing(shot)) === item.url) z += 1;
            }
          }
        }
      }
      const t = totals.get(name) ?? { j: 0, z: 0, n: 0 };
      totals.set(name, { j: t.j + j, z: t.z + z, n: t.n + n });
      console.log(`${pick} n=${p.modules} m=${p.module.toFixed(3)} ${name.padEnd(18)} jsQR ${j}/${n} zxing ${z}/${n}`);
    }
  }
  console.log("\nитого:");
  for (const [name, t] of totals) console.log(`  ${name.padEnd(18)} jsQR ${t.j}/${t.n} (${((100 * t.j) / t.n).toFixed(1)} %) zxing ${t.z}/${t.n}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
