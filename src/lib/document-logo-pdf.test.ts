import assert from "node:assert/strict";
import test from "node:test";

import { createCanvas } from "@napi-rs/canvas";

import { buildDocumentOrgBlock } from "@/lib/document-org-block";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { renderOrderPdf } from "@/lib/orders/pdf";
import {
  SVG_LOGO_SANS,
  SVG_LOGO_SERIF,
  fitPdfLogo,
  isOwnUploadedLogo,
  pdfLogoFromFile,
  resolveSvgFontFamilies,
  type PdfLogo,
} from "@/lib/pdf-logo";
import { buildPpkProgramPdf } from "@/lib/ppk/pdf";
import { ppkPrintOrgFromBlock } from "@/lib/ppk/print-org";
import type { PpkBundle } from "@/lib/ppk/assemble.server";

/**
 * Логотип организации в PDF (2026-10-17): журналы, ППК, приказы. Без
 * логотипа в файле нет ни одной картинки — документ печатается как раньше.
 */

function pngLogo(width = 240, height = 64): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d93a3a";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(10, 10, width / 3, height - 20);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

const SVG_LOGO = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><rect width="300" height="100" rx="16" fill="#1f3a8a"/><circle cx="50" cy="50" r="30" fill="#fcd34d"/></svg>',
);

/**
 * Сколько картинок (XObject /Image) в PDF jsPDF (без сжатия словарей).
 * Прозрачность PNG jsPDF кладёт отдельной картинкой-маской (`/SMask`) —
 * это часть того же логотипа, её не считаем.
 */
function imageCount(pdf: Uint8Array | Buffer): number {
  const source = Buffer.from(pdf).toString("latin1");
  const images = (source.match(/\/Subtype \/Image/g) ?? []).length;
  const masks = (source.match(/\/SMask \d+ 0 R/g) ?? []).length;
  return images - masks;
}

/** Текст первой страницы PDF (pdfjs), пробелы схлопнуты. */
async function firstPageText(pdf: Uint8Array | Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const content = await (await doc.getPage(1)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ");
  } finally {
    await task.destroy();
  }
}

async function logo(): Promise<PdfLogo> {
  const result = await pdfLogoFromFile({ bytes: pngLogo(), mime: "image/png" });
  assert.ok(result);
  return result;
}

test("PNG — как есть с размером из заголовка, SVG растеризуется с сохранением пропорций", async () => {
  const png = await pdfLogoFromFile({ bytes: pngLogo(240, 64), mime: "image/png" });
  assert.deepEqual(png && { width: png.width, height: png.height }, { width: 240, height: 64 });

  const svg = await pdfLogoFromFile({ bytes: SVG_LOGO, mime: "image/svg+xml" });
  assert.ok(svg, "SVG растеризован");
  assert.ok(Math.abs(svg.width / svg.height - 3) < 0.05, `пропорции 3:1, получилось ${svg.width}×${svg.height}`);
  assert.equal(Buffer.from(svg.data.subarray(1, 4)).toString("latin1"), "PNG");

  assert.equal(await pdfLogoFromFile({ bytes: new TextEncoder().encode("not an image"), mime: "image/png" }), null);
});

test("логотип вписывается в коробку с сохранением пропорций", () => {
  assert.deepEqual(fitPdfLogo({ width: 240, height: 64 }, 50, 9), { w: 33.75, h: 9 });
  const wide = fitPdfLogo({ width: 1000, height: 50 }, 50, 9);
  assert.equal(wide.w, 50);
  assert.equal(wide.h, 2.5);
});

test("PDF журнала: без логотипа — ни одной картинки, с логотипом (PNG и SVG) — картинка в шапке", async () => {
  for (const code of ["hygiene", "cold_equipment_control", "finished_product"]) {
    const plain = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr: null });
    assert.equal(imageCount(plain.buffer), 0, `${code}: без логотипа`);
    const branded = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr: null, logo: await logo() });
    assert.equal(imageCount(branded.buffer), 1, `${code}: логотип один раз на документ`);
  }
  const svg = await pdfLogoFromFile({ bytes: SVG_LOGO, mime: "image/svg+xml" });
  const fromSvg = renderJournalDocumentPdf({ ...buildJournalSampleInput("hygiene"), qr: null, logo: svg });
  assert.equal(imageCount(fromSvg.buffer), 1);
});

test("PDF журнала: КПП и телефон точки — в шапке документа точки, без точки их нет", async () => {
  const input = buildJournalSampleInput("cold_equipment_control");
  const document = {
    ...input.document,
    building: { name: "Точка 2", address: "ул. Ленина, 5", journalName: null, kpp: "770102002", phone: "+7 900 111-22-33" },
  } as typeof input.document;
  const withPoint = await firstPageText(renderJournalDocumentPdf({ ...input, document, qr: null }).buffer);
  for (const part of ["Точка 2", "ИНН 7701234567", "КПП 770102002", "тел. +7 900 111-22-33"]) {
    assert.ok(withPoint.replace(/\s/g, "").includes(part.replace(/\s/g, "")), `в шапке нет «${part}»: ${withPoint.slice(0, 300)}`);
  }
  const plain = await firstPageText(renderJournalDocumentPdf({ ...input, qr: null }).buffer);
  assert.ok(!plain.includes("КПП"), "без точки и КПП шапка прежняя");
});

const bundle = (org: ReturnType<typeof ppkPrintOrgFromBlock>, pdfLogo: PdfLogo | null): PpkBundle =>
  ({
    org,
    logo: pdfLogo,
    team: [],
    policy: null,
    products: [],
    flowcharts: [],
    hazards: [],
    points: [],
    norms: [],
    lab: [],
    pest: [],
    journals: [],
    staffCount: 0,
    positions: [],
    responsibles: [],
    roster: [],
    approvals: { ppk: null, "haccp-plan": null },
  }) as PpkBundle;

test("PDF ППК и приказа: логотип есть только у организации с логотипом", async () => {
  const org = ppkPrintOrgFromBlock(
    buildDocumentOrgBlock({ org: { name: "ООО «Тест»", inn: "7700000000", kpp: "770001001", brandColor: "#d93a3a" } }),
  );
  assert.equal(imageCount(buildPpkProgramPdf(bundle(org, null))), 0);
  assert.equal(imageCount(buildPpkProgramPdf(bundle(org, await logo()))), 1);

  const template = ORDER_TEMPLATES[0];
  const orderOrg = { orgName: "ООО «Тест»", orgShortName: "ООО «Тест»", orgInn: "7700000000", orgKpp: "770001001", orgAddress: null, directorName: null, directorPost: null, city: null };
  const base = { template, org: orderOrg, values: {}, number: "1", issuedAt: new Date("2026-10-17T12:00:00Z") };
  assert.equal(imageCount(renderOrderPdf(base).buffer), 0);
  assert.equal(imageCount(renderOrderPdf({ ...base, logo: await logo(), brandColor: "#d93a3a" }).buffer), 1);

  // SVG-логотип (растр на сервере) — так же один раз на документ.
  const svg = await pdfLogoFromFile({ bytes: SVG_LOGO, mime: "image/svg+xml" });
  assert.ok(svg);
  assert.equal(imageCount(buildPpkProgramPdf(bundle(org, svg))), 1);
  assert.equal(imageCount(renderOrderPdf({ ...base, logo: svg }).buffer), 1);
});

test("в PDF — только загруженный файл своей организации: внешняя ссылка и чужой файл не читаются (SSRF)", () => {
  assert.equal(isOwnUploadedLogo("org1", "/api/org-assets/org1/logo?v=3"), true);
  assert.equal(isOwnUploadedLogo("org1", "/api/org-assets/org1/logo"), true);
  assert.equal(isOwnUploadedLogo("org1", "/api/org-assets/org2/logo?v=1"), false);
  assert.equal(isOwnUploadedLogo("org1", "/api/org-assets/org12/logo?v=1"), false);
  assert.equal(isOwnUploadedLogo("org1", "https://example.com/logo.png"), false);
  assert.equal(isOwnUploadedLogo("org1", "http://127.0.0.1:5432/"), false);
  assert.equal(isOwnUploadedLogo("org1", null), false);
});

test("SVG-логотип: шрифты текста сводятся к установленному или к нашему с кириллицей", () => {
  const installed = (family: string) => family === "Arial";
  const fix = (svg: string) => resolveSvgFontFamilies(svg, installed);

  // Атрибут: первое установленное имя списка; незнакомое и общее — наш шрифт.
  assert.match(fix('<svg><text font-family="Montserrat, Arial">Т</text></svg>'), /<text font-family="Arial">/);
  assert.match(fix(`<svg><text font-family="'Montserrat', sans-serif">Т</text></svg>`), new RegExp(`<text font-family="${SVG_LOGO_SANS}">`));
  assert.match(fix("<svg><text font-family='Georgia, serif'>Т</text></svg>"), new RegExp(`<text font-family='${SVG_LOGO_SERIF}'>`));
  // style="…" и <style>: имя с пробелами — в кавычках другого вида.
  assert.match(fix(`<svg><text style="fill:#000;font-family:'Montserrat';font-size:20px">Т</text></svg>`), new RegExp(`style="fill:#000;font-family: '${SVG_LOGO_SANS}';font-size:20px"`));
  assert.match(fix("<svg><style>.a{font-family:Montserrat-Bold, Montserrat;font-weight:700}</style></svg>"), new RegExp(`\\.a\\{font-family: '${SVG_LOGO_SANS}';font-weight:700\\}`));
  // Шрифт по умолчанию — на корне; свой шрифт корня не трогаем.
  assert.match(fix('<svg viewBox="0 0 10 10"><text>Т</text></svg>'), new RegExp(`^<svg font-family="${SVG_LOGO_SANS}" viewBox`));
  assert.equal(fix('<svg font-family="Arial"><text>Т</text></svg>'), '<svg font-family="Arial"><text>Т</text></svg>');
});

test("SVG-логотип с кириллицей и незнакомым шрифтом растеризуется нашим шрифтом, а не квадратиками", async () => {
  const svg = (family: string) =>
    new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60"><rect width="240" height="60" fill="#fff"/><text x="8" y="44" font-family="${family}" font-size="36" font-weight="700" fill="#000">Точки</text></svg>`,
    );
  const unknown = await pdfLogoFromFile({ bytes: svg("NoSuchLogoFont-2026"), mime: "image/svg+xml" });
  const ours = await pdfLogoFromFile({ bytes: svg(SVG_LOGO_SANS), mime: "image/svg+xml" });
  assert.ok(unknown && ours);
  assert.ok(Buffer.from(unknown.data).equals(Buffer.from(ours.data)), "незнакомый шрифт заменён нашим DejaVu Sans");
});
