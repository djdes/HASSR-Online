import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";

import { buildProposalContent } from "./content";
import { MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W, renderProposalPdfDocument } from "./pdf";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "./sample";
import type { ProposalPromo } from "./types";

/**
 * КП всегда на ОДНОМ листе A4 и ничего не выходит за поля. Полная матрица
 * (все сферы × 3 варианта промокода × короткое/длинное название) с проверкой
 * текста через pdf.js и чтением QR — в скриптах задачи
 * (`.agent/tasks/proposal-kp/verify-pdf.ts`); здесь — все сферы в худшем
 * случае (длинное название, промокод со сроком, заметки) и выборочно
 * остальные варианты.
 */

const LONG_NAME = "Общество с ограниченной ответственностью «Столовая при заводе металлоконструкций»".slice(0, 80);
const EPS = 0.01;

function check(sphere: OrgSphere, promo: ProposalPromo | null, companyName: string | null) {
  const content = buildProposalContent(
    { sphere, companyName, recipientName: companyName ? "Анна Сергеевна" : null, promo },
    sampleProposalContext(),
  );
  const render = renderProposalPdfDocument(content);
  assert.equal(render.pages, 1, `${sphere}: страниц ${render.pages}`);
  for (const box of render.bounds) {
    assert.ok(box.x0 >= MARGIN_X - EPS && box.x1 <= PAGE_W - MARGIN_X + EPS, `${sphere}: ${box.what} за левым/правым полем (${box.x0.toFixed(1)}–${box.x1.toFixed(1)})`);
    assert.ok(box.y0 >= MARGIN_TOP - EPS && box.y1 <= PAGE_H - MARGIN_BOTTOM + EPS, `${sphere}: ${box.what} за верхним/нижним полем (${box.y0.toFixed(1)}–${box.y1.toFixed(1)})`);
  }
  assert.equal(render.qr.url, content.offer.ctaUrl);
  assert.ok(render.qr.box.x1 - render.qr.box.x0 >= 28, `${sphere}: QR мельче 28 мм`);
  assert.equal(render.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  return render;
}

describe("PDF КП — один лист A4", () => {
  it(`длинное название (${LONG_NAME.length} знаков) и промокод со сроком — все сферы`, () => {
    assert.equal(LONG_NAME.length, 80);
    for (const { value } of ORG_SPHERES) check(value, SAMPLE_PROMO_UNTIL, LONG_NAME);
  });

  it("без промокода и с промокодом навсегда — выборочно", () => {
    for (const sphere of ["restaurant", "education", "hotel", "beauty", "medical"] as OrgSphere[]) {
      check(sphere, null, null);
      check(sphere, SAMPLE_PROMO_LIFETIME, "Кафе «Ромашка»");
    }
  });

  it("QR с промокодом ведёт на /promo/<CODE>?s=<сфера>", () => {
    const render = check("cafe", SAMPLE_PROMO_LIFETIME, "Кафе «Ромашка»");
    assert.equal(render.qr.url, "https://wesetup.ru/promo/ROMASHKA10?s=cafe");
    // Модуль QR на бумаге не мельче 0,5 мм — читается любой камерой.
    assert.ok(render.qr.module >= 0.5, `модуль ${render.qr.module.toFixed(2)} мм`);
  });
});
