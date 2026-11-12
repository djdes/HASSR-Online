import assert from "node:assert/strict";
import test from "node:test";

import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

import {
  BRAND_CONTENT_TOP,
  BrandFlow,
  bankGrid,
  brandAsset,
  brandSeller,
  createBrandPdf,
  dataTable,
  decoratePages,
  hyphenationPoints,
  partyRows,
  sectionTitle,
  signatureBlock,
  signatureLine,
} from "./pdf-kit";
import { formatPhone } from "./phone";

const SELLER = brandSeller({
  nameFull: "Общество с ограниченной ответственностью «Тест»",
  nameShort: "ООО «Тест»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  phone: "84950000000",
  email: "docs@example.ru",
  head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
  bank: { name: "АО «Банк»", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
});

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

test("phone formatting for documents", () => {
  assert.equal(formatPhone("+74951096543").replace(/\s/g, " "), "+7 (495) 109-65-43");
  assert.equal(formatPhone("8 (495) 109-65-43").replace(/\s/g, " "), "+7 (495) 109-65-43");
  assert.equal(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(SELLER.phone.replace(/\s/g, " "), "+7 (495) 000-00-00");
});

test("brand kit: assets ship with the repo, every block renders, header and footer on each page", async () => {
  for (const asset of ["wordmark-polnoch.png", "route-header.png", "route-footer.png", "icon-phone.png", "icon-mail.png", "check.png"] as const) {
    assert.ok(brandAsset(asset), asset);
  }
  const pdf = createBrandPdf({ title: "Kit smoke" });
  assert.equal(pdf.brandFont, true, "Manrope is bundled");
  let y = bankGrid(pdf, { y: BRAND_CONTENT_TOP, seller: SELLER }) + 6;
  y += sectionTitle(pdf, 12, y + 4, { num: 1, title: "Стоимость", hint: "за 1 точку" }) + 3;
  y = dataTable(pdf, { startY: y, head: [["№", "Наименование", "Сумма"]], body: [["1", "Доступ к сервису", "3 000,00"], ["2", "Настройка", "10 000,00"]] }) + 4;
  y = partyRows(pdf, { y, rows: [{ label: "Поставщик", value: "ООО «Тест», ИНН 5018215599", strong: true }, { label: "Покупатель", value: "ООО «Клиент»" }] }) + 4;
  y = signatureLine(pdf, { x: 12, y, width: 90, post: "Генеральный директор", name: "Тестов Т. Т." }) + 2;
  signatureBlock(pdf, { y, sender: { name: "Тест Тестов", post: "Генеральный директор", orgShort: "ООО «Тест»" } });
  const flow = new BrandFlow(pdf);
  flow.newPage();
  for (let index = 0; index < 70; index += 1) flow.paragraph(`Абзац ${index + 1}: длинный текст, который переносится по ширине и уходит на следующий лист, когда место кончается.`, { lead: `${index + 1}.` });
  const pages = decoratePages(pdf, SELLER, { pageLabel: (page, total) => `Тест · Стр. ${page} из ${total}` });
  assert.ok(pages >= 3, `pages: ${pages}`);

  const { text, pages: parsed } = await pdfText(Buffer.from(pdf.doc.output("arraybuffer")));
  assert.equal(parsed, pages);
  // «Ваш электронный ХАССП» — и в шапке, и в подвале каждой страницы (12.11.2026: «у нас везде так»).
  assert.equal((text.match(/Ваш электронный ХАССП/g) ?? []).length, pages * 2, "letterhead and footer on every page");
  assert.ok(!text.includes("Электронные журналы"), "no old footer tagline");
  for (const expected of ["5018215599", "40702810000000000001", "Стоимость", "Доступ к сервису", "Поставщик", "С уважением", `Стр. ${pages} из ${pages}`, "Абзац 70"]) {
    assert.ok(text.includes(expected), `has ${expected}`);
  }
});

test("russian hyphenation: syllable boundaries, short words, latin and abbreviations untouched", () => {
  assert.deepEqual(hyphenationPoints("договор"), [2, 4]);
  assert.deepEqual(hyphenationPoints("Исполнитель"), [2, 5, 7]);
  for (const word of ["WeSetup", "ИНН", "СанПиН", "ХАССП", "точка", "2026"]) assert.deepEqual(hyphenationPoints(word), [], word);
  // «й», «ъ», «ь» не начинают строку, справа остаётся не меньше трёх букв.
  for (const word of ["подъезда", "большой", "сотрудников", "оборудования"]) {
    for (const point of hyphenationPoints(word)) {
      assert.ok(!/[йъь]/i.test(word[point]), `${word}: ${point}`);
      assert.ok(point >= 2 && word.length - point >= 3, `${word}: ${point}`);
    }
  }
});
