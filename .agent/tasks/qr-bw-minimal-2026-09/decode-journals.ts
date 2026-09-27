/**
 * Распознавание QR печатных журналов (AC2): для каждого бланка — первая
 * страница с QR и первый повтор шапки, снимки при 150 и 300 dpi
 * (`journal-qr-header-2026-09/qr-sim.ts`, сетка пикселей — от края листа):
 *   • clean — растр реального размера; bw — серый + порог 50 %;
 *   • bw-print — ч/б принтер: серый + порог при 600 dpi, потом снимок;
 *   • phone — «как с телефона»: перспектива 4 % + поворот 5–10° (свой у
 *     каждого бланка, знак чередуется) → размытие σ 0,6 px → JPEG 90;
 *   • bw-phone — ч/б принтер, снятый телефоном;
 *   • phone-hard, bw-phone-hard — стресс: перспектива 8 %, σ 0,8 px, JPEG 85.
 * Декодеры — jsQR и zxing-cpp (npm zxing-wasm) из QR_VERIFY_DIR (вне проекта).
 * Успех — строка декодера ровно равна адресу бланка.
 *
 * Приёмка (спека): 300 dpi — clean / bw / bw-print / phone / bw-phone, оба
 * декодера 100 %; 150 dpi — clean / bw / bw-print / phone / bw-phone,
 * zxing-cpp 100 % (jsQR на 150 dpi — для сведения). Жёсткий телефон — стресс.
 *
 *   QR_VERIFY_DIR=D:/wt-build/verify-bwqr node --import tsx \
 *     .agent/tasks/qr-bw-minimal-2026-09/decode-journals.ts <набор,набор> [метка,метка]
 * Итог — raw/decode-journals-<наборы>.json (компактно: строка отметок на страницу).
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { PHONE, PHONE_HARD, decodeJsQr, decodeZxing, openPdf, pageSizeMm, savePng, shotsOf, type ShotKind } from "../journal-qr-header-2026-09/qr-sim";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-bw-minimal-2026-09");
const DPIS = [150, 300];

/** Кто должен прочитать снимок для приёмки: оба декодера / только zxing-cpp / никто (стресс). */
export function acceptanceOf(dpi: number, kind: ShotKind): "both" | "zxing" | "stress" {
  if (kind === "phone-hard" || kind === "bw-phone-hard") return "stress";
  return dpi >= 300 ? "both" : "zxing";
}

type PageRow = {
  set: string;
  label: string;
  page: number;
  role: "first" | "repeat";
  where: JournalQrPlacement["where"];
  modules: number;
  moduleMm: number;
  angle: number;
  /** «300clean:JZ» — J/Z прочитал jsQR / zxing-cpp, «-» — нет. */
  marks: string;
};

async function main() {
  const [setsArg, labelsArg] = process.argv.slice(2);
  const sets = new Set((setsArg ?? "samples").split(","));
  const labels = labelsArg ? new Set(labelsArg.split(",")) : null;
  const saveDir = process.env.DECODE_SAVE ? path.resolve(process.env.DECODE_SAVE) : null;
  const rows: PageRow[] = [];
  const tally = new Map<string, { j: number; z: number; n: number; acceptance: string }>();
  const misses: string[] = [];
  let caseIndex = 0;
  for (const item of buildCases(sets)) {
    if (labels && !labels.has(item.label)) continue;
    const rendered = item.render("stamp");
    const placements = (rendered.qrPlacements ?? []) as JournalQrPlacement[];
    const first = placements.find((p) => p.box);
    const repeat = placements.find((p) => p.box && p.where === "header" && first && p.page > first.page);
    const doc = await openPdf(rendered.buffer);
    for (const [role, p] of [
      ["first", first],
      ["repeat", repeat],
    ] as const) {
      if (!p || !p.box) continue;
      const angle = (5 + ((caseIndex * 2 + (role === "repeat" ? 1 : 0)) % 6)) * (caseIndex % 2 === 0 ? 1 : -1);
      const size = await pageSizeMm(doc, p.page);
      // Кадр: плитка + часть шапки слева, до края листа справа и сверху.
      const box = {
        x0: Math.max(0, p.box.x0 - 14),
        y0: Math.max(0, p.box.y0 - 8),
        x1: Math.min(size.width, p.box.x1 + 8),
        y1: Math.min(size.height, p.box.y1 + 8),
      };
      const shots = await shotsOf(doc, p.page, box, DPIS, { phone: { ...PHONE, angle }, hard: { ...PHONE_HARD, angle } });
      const marks: string[] = [];
      for (const shot of shots) {
        const jsqr = decodeJsQr(shot.raster) === item.url;
        const zxing = (await decodeZxing(shot.raster)) === item.url;
        const acceptance = acceptanceOf(shot.dpi, shot.kind);
        const key = `${shot.dpi} dpi ${shot.kind}`;
        const t = tally.get(key) ?? { j: 0, z: 0, n: 0, acceptance };
        t.n += 1;
        if (jsqr) t.j += 1;
        if (zxing) t.z += 1;
        tally.set(key, t);
        marks.push(`${shot.dpi}${shot.kind}:${jsqr ? "J" : "-"}${zxing ? "Z" : "-"}`);
        const failed = (acceptance === "both" && (!jsqr || !zxing)) || (acceptance === "zxing" && !zxing);
        if (failed) misses.push(`${item.set}:${item.label} стр. ${p.page} ${shot.dpi} dpi ${shot.kind} jsQR=${jsqr} zxing=${zxing}`);
        if (saveDir && failed) savePng(shot.raster, path.join(saveDir, `${item.set}-${item.label}-p${p.page}-${shot.dpi}-${shot.kind}.png`));
      }
      rows.push({ set: item.set, label: item.label, page: p.page, role, where: p.where, modules: p.modules, moduleMm: +p.module.toFixed(4), angle, marks: marks.join(" ") });
      console.log(`${item.set}:${item.label} стр. ${p.page} (${role}, ${p.where}) n=${p.modules} m=${p.module.toFixed(3)} угол ${angle}° | ${marks.join(" ")}`);
    }
    await doc.close();
    caseIndex += 1;
  }
  const summary = [...tally.entries()].map(([shot, t]) => ({ shot, jsqr: `${t.j}/${t.n}`, zxing: `${t.z}/${t.n}`, acceptance: t.acceptance }));
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  const file = path.join(TASK_DIR, "raw", `decode-journals-${[...sets].join("+")}${labels ? "-part" : ""}.json`);
  fs.writeFileSync(file, JSON.stringify({ pages: rows.length, cases: caseIndex, summary, misses, rows }));
  console.log("\nснимок | jsQR | zxing-cpp | приёмка");
  for (const s of summary) console.log(`${s.shot} | ${s.jsqr} | ${s.zxing} | ${s.acceptance}`);
  console.log(`\nстраниц ${rows.length}, бланков ${caseIndex}; мимо приёмки: ${misses.length}`);
  for (const m of misses) console.log(`  не прочитано: ${m}`);
  process.exit(misses.length ? 1 : 0);
}

if (process.argv[1] && /decode-journals\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
