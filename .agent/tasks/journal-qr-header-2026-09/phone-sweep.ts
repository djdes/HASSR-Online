/**
 * Разброс «снимка телефоном»: настоящие шапки (длинные документы: 53 и 49
 * модулей; шаблон /qb), 12 поворотов (±5…10°) × три степени «телефона»
 * (перспектива 4/6/8 %, размытие σ 0,6/0,7/0,8 px, JPEG 90/85) при 300 и
 * 150 dpi — сколько снимков читает jsQR и zxing-cpp. Итог — raw/phone-sweep.txt.
 *
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/phone-sweep.ts
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";
import { buildCases } from "./pages";
import { decodeJsQr, decodeZxing, openPdf, phoneCapture, renderRegion, threshold } from "./qr-sim";

const PARAMS = [
  { name: "light k4 b0.6 j90", keystone: 0.04, blur: 0.6, jpeg: 90 },
  { name: "mid k6 b0.7 j85", keystone: 0.06, blur: 0.7, jpeg: 85 },
  { name: "hard k8 b0.8 j85", keystone: 0.08, blur: 0.8, jpeg: 85 },
];
const ANGLES = [5, 6, 7, 8, 9, 10, -5, -6, -7, -8, -9, -10];

async function main() {
  const cases = buildCases(new Set(["long", "blanks"]));
  const pick = [
    ["long", "cleaning_ventilation_checklist"],
    ["long", "incoming_raw_materials_control"],
    ["long", "hygiene"],
    ["long", "med_books"],
    ["blanks", "hygiene"],
  ];
  for (const [set, label] of pick) {
    const item = cases.find((c) => c.set === set && c.label === label)!;
    const rendered = item.render() as { buffer: Buffer; qrPlacements: Array<{ page: number; box: { x0: number; y0: number; x1: number; y1: number } | null; modules: number; module: number }> };
    const p = rendered.qrPlacements.find((q) => q.box)!;
    const doc = await openPdf(rendered.buffer);
    const box = { x0: p.box!.x0 - 12, y0: Math.max(0, p.box!.y0 - 6), x1: Math.min(297, p.box!.x1 + 8), y1: p.box!.y1 + 8 };
    const master = await renderRegion(doc, p.page, box, 600);
    await doc.close();
    const masterBw = threshold(master);
    // Ожидаемый адрес — то, что декодирует zxing с чистого 600 dpi.
    const url = await decodeZxing(master);
    for (const prm of PARAMS) {
      for (const dpi of [300, 150]) {
        let j = 0, z = 0, jb = 0, zb = 0;
        for (const angle of ANGLES) {
          const shot = await phoneCapture(master, 600, dpi, { angle, keystone: prm.keystone, blur: prm.blur, jpeg: prm.jpeg });
          if (decodeJsQr(shot) === url) j += 1;
          if ((await decodeZxing(shot)) === url) z += 1;
          const shotBw = await phoneCapture(masterBw, 600, dpi, { angle, keystone: prm.keystone, blur: prm.blur, jpeg: prm.jpeg });
          if (decodeJsQr(shotBw) === url) jb += 1;
          if ((await decodeZxing(shotBw)) === url) zb += 1;
        }
        console.log(`${set}:${label} n=${p.modules} m=${p.module.toFixed(3)} ${prm.name} ${dpi}dpi | phone jsQR ${j}/${ANGLES.length} zxing ${z}/${ANGLES.length} | bw-phone jsQR ${jb}/${ANGLES.length} zxing ${zb}/${ANGLES.length}`);
      }
    }
  }
}
main();
