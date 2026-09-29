/**
 * Проверка PDF КП по спеке (раздел «Проверка → PDF»):
 *   • все сферы × {без промокода, 10 % навсегда, 10 % до даты} × {короткое, 80 знаков};
 *   • ровно одна страница (pdf.js), весь текст внутри полей (координаты текста pdf.js);
 *   • QR читается jsQR и zxing-cpp (150 и 300 dpi, чистый снимок и «телефон») в правильный URL;
 *   • PNG первой страницы при 150 dpi — для 5 сфер (и ч/б вариант).
 *
 *   QR_VERIFY_DIR=d:/wt/tmp-kp/verify KP_OUT=d:/wt/tmp-kp/verify-out node --import tsx .agent/tasks/proposal-kp/verify-pdf.ts
 *
 * Декодеры (jsqr, zxing-wasm) ставятся во временную папку QR_VERIFY_DIR, не в проект.
 */
import fs from "node:fs";
import path from "node:path";

import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { buildProposalContent } from "@/lib/proposal/content";
import { MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W, renderProposalPdfDocument } from "@/lib/proposal/pdf";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "@/lib/proposal/sample";
import type { ProposalPromo } from "@/lib/proposal/types";

import { PHONE, decodeJsQr, decodeZxing, openPdf, shotsOf } from "../journal-qr-header-2026-09/qr-sim";
import { pageToPng } from "./preview";

const OUT = path.resolve(process.env.KP_OUT ?? "d:/wt/tmp-kp/verify-out");
const LONG_NAME = "Общество с ограниченной ответственностью «Столовая при заводе металлоконструкций»".slice(0, 80);
const PNG_SPHERES: OrgSphere[] = ["restaurant", "cafe", "education", "hotel", "beauty"];
/** Допуск на сглаживание координат pdf.js, мм. */
const EPS = 0.2;
const PT_TO_MM = 25.4 / 72;
/** Выносные элементы Manrope относительно кегля (hhea ascent/descent / 2000). */
const ASCENT = 1.066;
const DESCENT = 0.3;

type Row = Record<string, unknown>;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];
  const failures: string[] = [];
  const promos: Array<[string, ProposalPromo | null]> = [
    ["none", null],
    ["lifetime", SAMPLE_PROMO_LIFETIME],
    ["until", SAMPLE_PROMO_UNTIL],
  ];
  const names: Array<[string, string | null]> = [
    ["short", "Кафе «Ромашка»"],
    ["long", LONG_NAME],
  ];

  for (const { value: sphere } of ORG_SPHERES) {
    for (const [promoKey, promo] of promos) {
      for (const [nameKey, companyName] of names) {
        const label = `${sphere}/${promoKey}/${nameKey}`;
        const content = buildProposalContent(
          { sphere, companyName, recipientName: "Анна Сергеевна", promo },
          sampleProposalContext(),
        );
        const render = renderProposalPdfDocument(content);
        const doc = await openPdf(render.buffer);
        const pages = doc.numPages;
        if (pages !== 1) failures.push(`${label}: страниц ${pages}`);

        // Текст — по координатам pdf.js: x/y базовой линии, ширина, кегль.
        const page = await doc.getPage(1);
        const text = (await page.getTextContent()) as unknown as {
          items: Array<{ str: string; transform: number[]; width: number; height: number }>;
        };
        let outside = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const item of text.items) {
          if (!item.str || !item.str.trim()) continue;
          const size = Math.hypot(item.transform[0], item.transform[1]) || item.height;
          const x0 = item.transform[4] * PT_TO_MM;
          const x1 = x0 + item.width * PT_TO_MM;
          const baseline = PAGE_H - item.transform[5] * PT_TO_MM;
          const top = baseline - size * ASCENT * PT_TO_MM;
          const bottom = baseline + size * DESCENT * PT_TO_MM;
          minX = Math.min(minX, x0);
          maxX = Math.max(maxX, x1);
          minY = Math.min(minY, top);
          maxY = Math.max(maxY, bottom);
          const inside =
            x0 >= MARGIN_X - EPS && x1 <= PAGE_W - MARGIN_X + EPS && top >= MARGIN_TOP - 1.5 && bottom <= PAGE_H - MARGIN_BOTTOM + EPS;
          if (!inside) {
            outside += 1;
            if (outside <= 3) failures.push(`${label}: «${item.str}» за полями (${x0.toFixed(1)}–${x1.toFixed(1)} × ${top.toFixed(1)}–${bottom.toFixed(1)})`);
          }
        }

        // Все тексты модели на странице (ничего не потерялось при вёрстке).
        const pageText = text.items.map((item) => item.str).join(" ").replace(/\s+/g, " ");
        const squash = (value: string) => value.replace(/[\s\u00a0]+/g, "");
        const flat = squash(pageText);
        const expected = [
          content.offer.rows[0].title,
          content.offer.rows[1].title,
          content.offer.rows[1].price,
          ...(content.offer.promoCode ? [content.offer.promoCode] : []),
          ...content.journalsRequired.map((item) => item.name),
          ...(content.companyName ? [content.companyName] : []),
        ];
        for (const piece of expected) {
          if (!flat.includes(squash(piece))) failures.push(`${label}: нет текста «${piece}»`);
        }

        // QR: окно кода + запас, 150/300 dpi, чистый и «телефон».
        const box = render.qr.box;
        const margin = 4;
        const shots = await shotsOf(
          doc,
          1,
          { x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin + 8 },
          [150, 300],
          { phone: { ...PHONE, angle: 7 } },
        );
        const marks: string[] = [];
        let qrOk = true;
        for (const shot of shots) {
          const jsqr = decodeJsQr(shot.raster) === render.qr.url;
          const zxing = (await decodeZxing(shot.raster)) === render.qr.url;
          if (!(jsqr && zxing)) qrOk = false;
          marks.push(`${shot.dpi}${shot.kind}:${jsqr ? "J" : "-"}${zxing ? "Z" : "-"}`);
        }
        if (!qrOk) failures.push(`${label}: QR ${marks.join(" ")}`);
        await doc.close();

        rows.push({
          label,
          pages,
          scale: render.scale,
          bytes: render.buffer.length,
          textItems: text.items.length,
          outside,
          textBox: [minX, minY, maxX, maxY].map((v) => Number(v.toFixed(1))),
          qrUrl: render.qr.url,
          qrModuleMm: Number(render.qr.module.toFixed(3)),
          qr: marks.join(" "),
        });
        console.log(`${label.padEnd(34)} pages=${pages} scale=${render.scale} bytes=${render.buffer.length} outside=${outside} qr=${marks.join(" ")}`);

        if (PNG_SPHERES.includes(sphere) && promoKey === "lifetime" && nameKey === "short") {
          await pageToPng(render.buffer, path.join(OUT, "png", `kp-${sphere}-150dpi.png`), 150);
          await pageToPng(render.buffer, path.join(OUT, "png", `kp-${sphere}-150dpi-bw.png`), 150, true);
          fs.writeFileSync(path.join(OUT, "png", `kp-${sphere}.pdf`), render.buffer);
        }
      }
    }
  }
  fs.writeFileSync(path.join(OUT, "verify-pdf.json"), JSON.stringify({ rows, failures }, null, 1));
  console.log(failures.length ? `\nПРОБЛЕМЫ (${failures.length}):\n${failures.join("\n")}` : `\nВсе ${rows.length} PDF: 1 страница, текст в полях, QR читается.`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
