import assert from "node:assert/strict";
import test from "node:test";

import { buildSellerSnapshot } from "@/lib/closing-documents/build";
import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

import { TOPUP_INVOICE_LINE_TITLE, buildInvoiceDraft } from "./build";
import { invoiceAgreementPhrase, invoicePaymentPayload, invoicePurpose, renderInvoicePdf } from "./pdf";

const REQUISITES = {
  ...EMPTY_REQUISITES,
  nameFull: "Общество с ограниченной ответственностью «Тест»",
  nameShort: "ООО «Тест»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  bank: { name: "АО «Банк»", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
  head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
};

const BUYER = { name: "ООО «Ромашка»", inn: "7707083893", kpp: "773601001", ogrn: null, address: "г. Москва", head: null };

function draft(amountRub = 3000, purpose: "subscription" | "topup" = "subscription") {
  return buildInvoiceDraft({
    order: { id: 1287, createdAt: new Date("2026-10-30T09:00:00Z"), amountRub, bundleConfig: null },
    tariff: { title: "Стандарт, 1 точка", periodDays: 30, priceRub: amountRub },
    seller: buildSellerSnapshot(REQUISITES),
    buyer: BUYER,
    purpose,
  });
}

async function pdfText(bytes: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const pdf = await task.promise;
    const parts: string[] = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      const content = await (await pdf.getPage(page)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str);
    }
    return { pages: pdf.numPages, text: parts.join(" ").replace(/\s+/g, " ") };
  } finally {
    await task.destroy();
  }
}

test("invoice PDF: one page, both INNs, number, amount in words, contract basis", async () => {
  const value = draft();
  value.basis = "Договор № WS-2026/0001 от 29.10.2026";
  const { pages, text } = await pdfText(renderInvoicePdf(value, { facsimile: null, stamp: null }));
  assert.equal(pages, 1);
  for (const expected of ["5018215599", "7707083893", "Счёт на оплату № 1287", "40702810000000000001", "Без налога (НДС)", "Назначение платежа", "Руководитель", "Главный бухгалтер"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.match(text, /[Тт]ри тысячи[^.]*рублей 00 копеек, без налога \(НДС\)/);
  assert.ok(text.includes("согласие с условиями договора № WS-2026/0001 от 29.10.2026"));
  assert.ok(text.includes("Тестов Т. Т.") || text.includes("Тестов Т. Т.".replace(" ", " ")));
});

test("payment QR payload follows GOST R 56042 (ST00012) and the purpose names the invoice", () => {
  const value = draft();
  const payload = invoicePaymentPayload(value)!;
  assert.match(payload, /^ST00012\|Name=Общество с ограниченной ответственностью «Тест»\|PersonalAcc=40702810000000000001\|BankName=АО «Банк»\|BIC=044500000\|CorrespAcc=30101810000000000001\|PayeeINN=5018215599\|KPP=501801001\|Sum=300000\|Purpose=Оплата по счёту № 1287 от 30\.10\.2026 за доступ к сервису WeSetup\. Без НДС$/);
  assert.equal(invoicePaymentPayload({ ...value, seller: { ...value.seller, bank: { name: "", bik: "", account: "", corrAccount: "" } } }), null, "no bank — no QR");
  const topup = draft(5000, "topup");
  assert.equal(topup.lines[0].title, TOPUP_INVOICE_LINE_TITLE);
  assert.match(invoicePurpose(topup), /пополнение баланса/);
});

test("agreement phrase: contract, public offer, anything else quoted", () => {
  assert.equal(invoiceAgreementPhrase("Договор № WS-2026/0003 от 29.10.2026"), "договора № WS-2026/0003 от 29.10.2026");
  assert.equal(invoiceAgreementPhrase("Договор-оферта (wesetup.ru/oferta)"), "договора-оферты (wesetup.ru/oferta)");
  assert.equal(invoiceAgreementPhrase("Заявка"), "«Заявка»");
});
