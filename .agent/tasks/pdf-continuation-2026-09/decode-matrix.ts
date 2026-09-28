/**
 * Копия `journal-qr-header-2026-09/decode-matrix.ts` (2026-09-28): первая
 * страница — фирменная плитка, страница повтора шапки — компактный код
 * продолжения (коррекция M, без знака и полосы). Приёмка спеки задачи
 * `pdf-continuation-2026-09`: 300 dpi — оба декодера 100 %, 150 dpi —
 * zxing-cpp 100 %; ч/б и «как с телефона» — при обоих dpi.
 *
 * Распознавание QR в шапке (AC3): для каждого бланка — первая страница и
 * страница повтора шапки (если есть), снимки при 150 и 300 dpi:
 *   • clean     — растр реального размера (pdf.js, сглаживание = усреднение по пикселю);
 *   • bw        — тот же снимок в сером + порог 50 % («ч/б»);
 *   • bw-print  — ч/б принтер: серый + порог при 600 dpi (тонер есть/нет), потом снимок;
 *   • phone     — «как с телефона»: лист 600 dpi → перспектива 4 % + поворот 5–10°
 *                 (угол свой у каждого бланка, знак чередуется) → снимок с
 *                 усреднением → размытие σ 0,6 px → JPEG 90;
 *   • bw-phone  — ч/б принтер, снятый телефоном;
 *   • phone-hard, bw-phone-hard — стресс, жёстче спеки: перспектива 8 %, σ 0,8 px, JPEG 85.
 * Декодеры — jsQR и zxing-cpp (npm zxing-wasm) из временной папки (`qr-sim.ts`).
 * Успех — строка декодера ровно равна адресу бланка.
 *
 * Приёмка (AC3): clean / bw / bw-print при 150 и 300 dpi, phone / bw-phone при
 * 300 dpi. Телефон при 150 dpi (≈ 2 px на модуль: лист целиком в кадре с
 * полуметра) и «жёсткий» телефон — стресс, в приёмку не входят.
 *
 * Запуск (из корня репо):
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/decode-matrix.ts <набор,набор> [метка,метка]
 * Итог — raw/decode-<наборы>.json.
 */
import fs from "node:fs";
import path from "node:path";

import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import {
  PHONE,
  PHONE_HARD,
  decodeJsQr,
  decodeZxing,
  openPdf,
  pageSizeMm,
  savePng,
  shotsOf,
  type ShotKind,
} from "../journal-qr-header-2026-09/qr-sim";

const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-continuation-2026-09");
const DPIS = [150, 300];
/** Приёмка: jsQR — 300 dpi, zxing-cpp — 150 и 300 dpi; снимки — чистый, ч/б, ч/б-принтер, телефон, ч/б + телефон. */
const ACCEPT_KINDS: ShotKind[] = ["clean", "bw", "bw-print", "phone", "bw-phone"];
const ACCEPT_JSQR_DPI = [300];
const ACCEPT_ZXING_DPI = [150, 300];

type Row = {
  set: string;
  label: string;
  page: number;
  role: "first" | "repeat";
  where: JournalQrPlacement["where"];
  variant: JournalQrPlacement["variant"];
  modules: number;
  moduleMm: number;
  angle: number;
  dpi: number;
  kind: ShotKind;
  pxPerModule: number;
  jsqr: boolean;
  zxing: boolean;
  /** Снимок входит в приёмку для jsQR / для zxing-cpp. */
  acceptJsqr: boolean;
  acceptZxing: boolean;
};

async function main() {
  const [setsArg, labelsArg] = process.argv.slice(2);
  const sets = new Set((setsArg ?? "samples").split(","));
  const labels = labelsArg ? new Set(labelsArg.split(",")) : null;
  const saveDir = process.env.DECODE_SAVE ? path.resolve(process.env.DECODE_SAVE) : null;
  const rows: Row[] = [];
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
      // Угол 5–10°, знак чередуется: у каждого бланка и страницы свой.
      const angle = (5 + ((caseIndex * 2 + (role === "repeat" ? 1 : 0)) % 6)) * (caseIndex % 2 === 0 ? 1 : -1);
      const size = await pageSizeMm(doc, p.page);
      // Кадр: плитка + часть шапки слева, до края листа справа и сверху.
      const box = {
        x0: Math.max(0, p.box.x0 - 14),
        y0: Math.max(0, p.box.y0 - 8),
        x1: Math.min(size.width, p.box.x1 + 8),
        y1: Math.min(size.height, p.box.y1 + 8),
      };
      const shots = await shotsOf(doc, p.page, box, DPIS, {
        phone: { ...PHONE, angle },
        hard: { ...PHONE_HARD, angle },
      });
      const marks: string[] = [];
      for (const shot of shots) {
        const jsqr = decodeJsQr(shot.raster) === item.url;
        const zxing = (await decodeZxing(shot.raster)) === item.url;
        rows.push({
          set: item.set,
          label: item.label,
          page: p.page,
          role,
          where: p.where,
          variant: p.variant,
          modules: p.modules,
          moduleMm: +p.module.toFixed(4),
          angle,
          dpi: shot.dpi,
          kind: shot.kind,
          pxPerModule: +((p.module * shot.dpi) / 25.4).toFixed(2),
          jsqr,
          zxing,
          acceptJsqr: ACCEPT_KINDS.includes(shot.kind) && ACCEPT_JSQR_DPI.includes(shot.dpi),
          acceptZxing: ACCEPT_KINDS.includes(shot.kind) && ACCEPT_ZXING_DPI.includes(shot.dpi),
        });
        marks.push(`${shot.dpi}${shot.kind}:${jsqr ? "J" : "-"}${zxing ? "Z" : "-"}`);
        if (saveDir && (!jsqr || !zxing)) {
          savePng(shot.raster, path.join(saveDir, `${item.set}-${item.label}-p${p.page}-${shot.dpi}-${shot.kind}.png`));
        }
      }
      console.log(`${item.set}:${item.label} стр. ${p.page} (${role}, ${p.variant}) n=${p.modules} m=${p.module.toFixed(3)} угол ${angle}° | ${marks.join(" ")}`);
    }
    await doc.close();
    caseIndex += 1;
  }
  fs.mkdirSync(path.join(TASK_DIR, "raw"), { recursive: true });
  const tag = process.env.DECODE_TAG ? `-${process.env.DECODE_TAG}` : "";
  fs.writeFileSync(path.join(TASK_DIR, "raw", `decode-${[...sets].join("+")}${tag}.json`), JSON.stringify(rows, null, 1));
  // Сводка: по варианту, dpi и снимку — прочитано/всего каждым декодером.
  const groups = new Map<string, { j: number; z: number; n: number; accJ: boolean; accZ: boolean }>();
  for (const r of rows) {
    const key = `${r.role === "first" ? "стр. 1 (плитка)" : "продолжение (компактный)"} | ${r.dpi} dpi ${r.kind}`;
    const g = groups.get(key) ?? { j: 0, z: 0, n: 0, accJ: r.acceptJsqr, accZ: r.acceptZxing };
    g.n += 1;
    if (r.jsqr) g.j += 1;
    if (r.zxing) g.z += 1;
    groups.set(key, g);
  }
  console.log("\nстраница | снимок | jsQR | zxing-cpp | приёмка");
  for (const [key, g] of groups) {
    console.log(`${key} | ${g.j}/${g.n} | ${g.z}/${g.n} | ${g.accJ ? "jsQR+zxing" : g.accZ ? "zxing" : "стресс"}`);
  }
  const accJ = rows.filter((r) => r.acceptJsqr);
  const accZ = rows.filter((r) => r.acceptZxing);
  console.log(
    `\nприёмка: jsQR ${accJ.filter((r) => r.jsqr).length}/${accJ.length}, zxing-cpp ${accZ.filter((r) => r.zxing).length}/${accZ.length}`,
  );
  const miss = rows.filter((r) => (r.acceptJsqr && !r.jsqr) || (r.acceptZxing && !r.zxing));
  for (const r of miss) console.log(`  не прочитано: ${r.set}:${r.label} стр. ${r.page} ${r.dpi} dpi ${r.kind} jsQR=${r.jsqr} zxing=${r.zxing}`);
  process.exit(miss.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
