/**
 * Устойчивость QR в шапке к «снимку телефоном» (для сравнения вариантов
 * раскладки и с master): настоящие шапки 8 бланков (37–53 модуля), 12
 * поворотов (±5…10°) × 3 степени «телефона» (лёгкий — как в приёмке;
 * средний; жёсткий) × 2 фазы сетки × «телефон» и «ч/б + телефон», 300 dpi.
 * Итог — по степени: сколько снимков читает jsQR и zxing-cpp.
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-bwqr node --import tsx \
 *     .agent/tasks/qr-bw-minimal-2026-09/header-sweep.ts <метка> [набор:метка ...]
 * JSON — в SWEEP_OUT (по умолчанию D:/wt-build/tmp-bwqr/sweeps/<метка>.json).
 * SWEEP_FINE=1 — мелкий разброс только на лёгком «телефоне» (как в приёмке):
 * повороты ±5…10° с шагом 0,5°, 4 фазы сетки, только jsQR (zxing-cpp читает всё).
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { decodeJsQr, decodeZxing, openPdf, pageSizeMm, phoneCapture, renderRegion, threshold, type Raster } from "../journal-qr-header-2026-09/qr-sim";

type Placement = { page: number; where: string; box: { x0: number; y0: number; x1: number; y1: number } | null; modules: number; module: number };

const FINE = process.env.SWEEP_FINE === "1";
const ANGLES = FINE
  ? Array.from({ length: 11 }, (_, i) => 5 + i / 2).flatMap((a) => [a, -a])
  : [5, 6, 7, 8, 9, 10, -5, -6, -7, -8, -9, -10];
const PHASES = FINE ? [0, 1, 2, 3] : [0, 1];
const STRENGTHS = [
  { name: "лёгкий", keystone: 0.04, blur: 0.6, jpeg: 90 },
  { name: "средний", keystone: 0.06, blur: 0.7, jpeg: 85 },
  { name: "жёсткий", keystone: 0.08, blur: 0.8, jpeg: 85 },
].slice(0, FINE ? 1 : 3);
export const SWEEP_PICKS = [
  "samples:hygiene",
  "samples:transport_temperature",
  "samples:cold_equipment_control",
  "samples:cleaning_ventilation_checklist",
  "long:hygiene",
  "long:med_books",
  "long:cleaning_ventilation_checklist",
  "blanks:hygiene",
];

function shift(r: Raster, dx: number): Raster {
  if (!dx) return r;
  const data = new Uint8ClampedArray(r.data.length).fill(255);
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width - dx; x += 1) {
      const from = (y * r.width + x) * 4;
      const to = from + dx * 4;
      data[to] = r.data[from];
      data[to + 1] = r.data[from + 1];
      data[to + 2] = r.data[from + 2];
    }
  }
  return { width: r.width, height: r.height, data };
}

async function main() {
  const [label, ...rest] = process.argv.slice(2);
  if (!label) throw new Error("метка прогона");
  const picks = rest.length ? rest : SWEEP_PICKS;
  const cases = buildCases(null);
  const out: Array<{ pick: string; modules: number; module: number; strength: string; jsqr: number; zxing: number; n: number; missed: string[] }> = [];
  for (const pick of picks) {
    const [set, name] = pick.split(":");
    const item = cases.find((c) => c.set === set && c.label === name)!;
    const rendered = item.render("stamp");
    const p = (rendered.qrPlacements as Placement[]).find((q) => q.where === "header")!;
    const doc = await openPdf(rendered.buffer);
    const size = await pageSizeMm(doc, p.page);
    const box = { x0: Math.max(0, p.box!.x0 - 12), y0: Math.max(0, p.box!.y0 - 6), x1: Math.min(size.width, p.box!.x1 + 8), y1: p.box!.y1 + 8 };
    const master = await renderRegion(doc, p.page, box, 600);
    await doc.close();
    for (const s of STRENGTHS) {
      let j = 0;
      let z = 0;
      let n = 0;
      const missed: string[] = [];
      for (const phase of PHASES) {
        const shifted = shift(master, phase);
        const bw = threshold(shifted);
        for (const angle of ANGLES) {
          for (const [kind, src] of [
            ["phone", shifted],
            ["bw-phone", bw],
          ] as const) {
            const shot = await phoneCapture(src, 600, 300, { angle, keystone: s.keystone, blur: s.blur, jpeg: s.jpeg });
            n += 1;
            const okJ = decodeJsQr(shot) === item.url;
            if (okJ) j += 1;
            else missed.push(`${kind} ${angle}° ф${phase}`);
            if (!FINE && (await decodeZxing(shot)) === item.url) z += 1;
          }
        }
      }
      out.push({ pick, modules: p.modules, module: +p.module.toFixed(4), strength: s.name, jsqr: j, zxing: z, n, missed });
      console.log(`${pick.padEnd(40)} n=${p.modules} m=${p.module.toFixed(3)} ${s.name.padEnd(8)} jsQR ${j}/${n} zxing ${z}/${n}${missed.length ? ` — ${missed.join(", ")}` : ""}`);
    }
  }
  console.log("\nитого по степени:");
  for (const s of STRENGTHS) {
    const rows = out.filter((r) => r.strength === s.name);
    const n = rows.reduce((a, r) => a + r.n, 0);
    console.log(`  ${s.name.padEnd(8)} jsQR ${rows.reduce((a, r) => a + r.jsqr, 0)}/${n} zxing ${rows.reduce((a, r) => a + r.zxing, 0)}/${n}`);
  }
  const file = path.resolve(process.env.SWEEP_OUT ?? `D:/wt-build/tmp-bwqr/sweeps/${label}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
}

if (process.argv[1] && /header-sweep\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
