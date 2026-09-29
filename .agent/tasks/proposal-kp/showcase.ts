/**
 * Итоговые PNG первой страницы КП (150 dpi, цвет и ч/б) для 5 сфер с «родными»
 * названиями — для владельца. Данные — образец (`src/lib/proposal/sample.ts`).
 *
 *   node --import tsx .agent/tasks/proposal-kp/showcase.ts   (выхлоп — d:/wt/tmp-kp/showcase)
 */
import fs from "node:fs";
import path from "node:path";

import { buildProposalContent } from "@/lib/proposal/content";
import { renderProposalPdfDocument } from "@/lib/proposal/pdf";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "@/lib/proposal/sample";
import type { ProposalVars } from "@/lib/proposal/types";

import { pageToPng } from "./preview";

const OUT = "d:/wt/tmp-kp/showcase";
const cases: Array<[string, ProposalVars]> = [
  ["restaurant", { sphere: "restaurant", companyName: "Ресторан «Прага»", recipientName: "Олег Викторович", promo: SAMPLE_PROMO_LIFETIME }],
  ["cafe", { sphere: "cafe", companyName: "Кафе «Ромашка»", recipientName: "Анна Сергеевна", promo: SAMPLE_PROMO_LIFETIME }],
  ["education", { sphere: "education", companyName: "Детский сад № 5 «Солнышко»", recipientName: "Анна Сергеевна", promo: SAMPLE_PROMO_UNTIL }],
  ["hotel", { sphere: "hotel", companyName: "Отель «Волга»", recipientName: "Мария Ивановна", promo: SAMPLE_PROMO_LIFETIME }],
  ["beauty", { sphere: "beauty", companyName: "Салон красоты «Лиса»", recipientName: null, promo: null }],
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, vars] of cases) {
    const render = renderProposalPdfDocument(buildProposalContent(vars, sampleProposalContext()));
    fs.writeFileSync(path.join(OUT, `kp-${name}.pdf`), render.buffer);
    await pageToPng(render.buffer, path.join(OUT, `kp-${name}-150dpi.png`), 150);
    await pageToPng(render.buffer, path.join(OUT, `kp-${name}-150dpi-bw.png`), 150, true);
    console.log(`${name}: pages=${render.pages} scale=${render.scale} bytes=${render.buffer.length}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
