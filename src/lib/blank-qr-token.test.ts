import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXTAUTH_SECRET = "test-secret-for-blank-qr-token-0123456789";

import JSZip from "jszip";

import { BLANK_COPYRIGHT, BLANK_QR_CAPTION, blankTargetKey } from "@/lib/blank-download";
import {
  BLANK_PDF_FOOTER,
  BLANK_QR_LINES,
  base32Decode,
  base32Encode,
  blankPdfQr,
  blankQrUrl,
  fitsJournalQr,
  knownBlankTargets,
  openBlankQrToken,
  sealBlankQrToken,
} from "@/lib/blank-qr-token";
import { BRAND_QR_CAPTION_TITLE, brandQrPng } from "@/lib/brand-qr";
import { renderJournalDocumentDocx } from "@/lib/document-docx";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderPaperJournalPdfDetailed } from "@/lib/paper-journal-pdf";
import { JOURNAL_QR_MAX_MODULES, journalQrMatrix } from "@/lib/pdf-journal-qr";
import { paperJournalById } from "@/lib/sphere-journal-rules";

/**
 * QR в скачанном шаблоне: `/qb/<токен>`, токен — AES-GCM над почтой,
 * журналом и моментом выдачи; копирайт и QR — на каждой странице файла.
 */

const HYGIENE = { kind: "code", code: "hygiene" } as const;

test("base32: туда-обратно, любой регистр, мусор — null", () => {
  for (const size of [0, 1, 2, 3, 4, 5, 7, 36, 75]) {
    const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 37 + size) & 0xff));
    const text = base32Encode(bytes);
    assert.match(text, /^[A-Z2-7]*$/);
    if (size > 0) {
      assert.deepEqual(base32Decode(text), bytes);
      assert.deepEqual(base32Decode(text.toLowerCase()), bytes, "сканер мог привести адрес к строчным");
    }
  }
  assert.equal(base32Decode("ABC1"), null, "цифр 0/1/8/9 в алфавите нет");
  assert.equal(base32Decode("AB="), null);
  assert.equal(base32Decode(""), null);
  assert.equal(base32Decode("AB"), null, "лишние биты в хвосте — не наш кодировщик");
});

test("токен: почта и журнал внутри, прочитать почту из адреса нельзя", () => {
  const issuedAt = Date.parse("2026-09-25T12:00:00Z");
  const token = sealBlankQrToken({ target: HYGIENE, email: "zav@example.com", issuedAt });
  assert.match(token, /^[A-Z2-7]+$/);
  assert.ok(!token.toLowerCase().includes("zav"), "почта не видна открытым текстом");
  const opened = openBlankQrToken(token);
  assert.deepEqual(opened, { target: HYGIENE, email: "zav@example.com", issuedAt: new Date(issuedAt) });
  assert.deepEqual(openBlankQrToken(token.toLowerCase()), opened);
  // Каждый выпуск — свой IV: одинаковые данные дают разные токены.
  assert.notEqual(sealBlankQrToken({ target: HYGIENE, email: "zav@example.com", issuedAt }), token);

  const bare = openBlankQrToken(sealBlankQrToken({ target: { kind: "paper", paperId: "fire_safety" }, issuedAt }));
  assert.deepEqual(bare, { target: { kind: "paper", paperId: "fire_safety" }, email: null, issuedAt: new Date(issuedAt) });
});

test("битый, изменённый или чужой токен — null", () => {
  const token = sealBlankQrToken({ target: HYGIENE, email: "zav@example.com" });
  const flip = (index: number) => token.slice(0, index) + (token[index] === "A" ? "B" : "A") + token.slice(index + 1);
  for (const index of [0, 5, 20, token.length - 3]) {
    assert.equal(openBlankQrToken(flip(index)), null, `изменён символ ${index}`);
  }
  assert.equal(openBlankQrToken(token.slice(0, -8)), null, "обрезан");
  assert.equal(openBlankQrToken("HELLO"), null);
  assert.equal(openBlankQrToken("не-base32"), null);
  assert.equal(openBlankQrToken("A".repeat(500)), null);

  const saved = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = "a-completely-different-server-secret-42";
  try {
    assert.equal(openBlankQrToken(token), null, "другой секрет — другой ключ");
  } finally {
    process.env.NEXTAUTH_SECRET = saved;
  }
});

test("журнал в токене: все журналы каталога и бумажные бланки распознаются однозначно", () => {
  const targets = knownBlankTargets();
  assert.ok(targets.length >= 50, `целей ${targets.length}`);
  assert.equal(new Set(targets.map(blankTargetKey)).size, targets.length);
  for (const target of targets) {
    const opened = openBlankQrToken(sealBlankQrToken({ target, email: "a@example.com" }));
    assert.deepEqual(opened?.target, target, blankTargetKey(target));
  }
  // Журнала больше нет в каталоге — токен читается, но без журнала.
  const gone = openBlankQrToken(sealBlankQrToken({ target: { kind: "code", code: "removed_journal" } }));
  assert.equal(gone?.target, null);
});

test("адрес QR влезает в шапку бланка (H, ≤ 53 модулей); почта до 32 байт — в QR, длиннее — токен без почты", () => {
  for (const target of knownBlankTargets()) {
    const bare = blankQrUrl("https://wesetup.ru", { target });
    assert.equal(bare.withEmail, false);
    assert.ok(fitsJournalQr(bare.url), blankTargetKey(target));
  }
  const email32 = "zaveduyushchaya@kombinat-pita.ru";
  assert.equal(email32.length, 32);
  const withEmail = blankQrUrl("https://wesetup.ru", { target: { kind: "code", code: "cleaning_ventilation_checklist" }, email: email32 });
  assert.equal(withEmail.withEmail, true);
  assert.match(withEmail.url, /^https:\/\/wesetup\.ru\/qb\/[A-Z2-7]+$/);
  assert.ok(journalQrMatrix(withEmail.url).modules.size <= JOURNAL_QR_MAX_MODULES);
  assert.equal(openBlankQrToken(withEmail.url.split("/qb/")[1])?.email, email32);

  // 33 байта и больше (до 2026-09-27 помещалось 39 — у углового QR была коррекция M).
  for (const email of [`a${email32}`, "zaveduyushchaya.proizv@kombinat-pita.ru"]) {
    const tooLong = blankQrUrl("https://wesetup.ru", { target: HYGIENE, email });
    assert.equal(tooLong.withEmail, false, `почта ${email.length} байт в QR не помещается`);
    assert.ok(fitsJournalQr(tooLong.url));
    assert.deepEqual(openBlankQrToken(tooLong.url.split("/qb/")[1])?.target, HYGIENE, "журнал остаётся");
  }
});

test("строка внизу PDF: «Заполнять с телефона — wesetup.ru» и копирайт", () => {
  assert.deepEqual(BLANK_QR_LINES, [BLANK_QR_CAPTION, BLANK_COPYRIGHT]);
  assert.equal(BLANK_QR_CAPTION, "Заполнять с телефона — wesetup.ru");
  assert.equal(BLANK_COPYRIGHT, "© WeSetup — электронные журналы ХАССП и СанПиН · wesetup.ru");
  const qr = blankPdfQr("https://wesetup.ru/", { target: HYGIENE, email: "zav@example.com" });
  assert.equal(qr.footer, BLANK_PDF_FOOTER);
  assert.equal(BLANK_PDF_FOOTER, `${BLANK_QR_CAPTION} · ${BLANK_COPYRIGHT}`);
  assert.equal(openBlankQrToken(qr.url.split("/qb/")[1])?.email, "zav@example.com");
});

async function pageTexts(pdf: Uint8Array): Promise<string[]> {
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
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

const COPYRIGHT_PARTS = ["© WeSetup — электронные журналы", "ХАССП и СанПиН · wesetup.ru", "Заполнять с телефона —"];

test("PDF образца: копирайт на КАЖДОЙ странице, QR в шапке каждой страницы", async () => {
  const input = buildJournalSampleInput("hygiene");
  const out = renderJournalDocumentPdf({ ...input, qr: blankPdfQr("https://wesetup.ru", { target: HYGIENE, email: "zav@example.com" }) });
  const texts = await pageTexts(new Uint8Array(out.buffer));
  assert.ok(texts.length >= 2, "многостраничный образец");
  assert.equal(out.qrPlacements?.length, texts.length);
  assert.ok(out.qrPlacements?.every((p) => p.where === "header"), "у гигиены шапка на каждой странице — QR в ней");
  texts.forEach((text, index) => {
    for (const part of COPYRIGHT_PARTS) assert.ok(text.includes(part), `стр. ${index + 1}: «${part}»`);
    // Стр. 1 — фирменная плитка с полосой; продолжения — компактный код без
    // полосы (компактная шапка, 2026-09-28).
    assert.equal(text.includes(BRAND_QR_CAPTION_TITLE), index === 0, `стр. ${index + 1}: полоса QR`);
    assert.equal(out.qrPlacements?.[index].variant, index === 0 ? "tile" : "compact");
  });
  // Сам образец не изменился: без QR — те же страницы и то же имя файла.
  const plain = renderJournalDocumentPdf(input);
  assert.equal(plain.fileName, out.fileName);
});

test("PDF бумажного бланка: копирайт на каждой странице, QR — справа в заголовке первой; без qr — как в кабинете", async () => {
  const journal = paperJournalById("ot_intro");
  assert.ok(journal);
  const params = { journal, organization: SAMPLE_ORGANIZATION, rows: [], blankRows: 18 };
  const out = renderPaperJournalPdfDetailed({ ...params, qr: blankPdfQr("https://wesetup.ru", { target: { kind: "paper", paperId: "ot_intro" } }) });
  const texts = await pageTexts(new Uint8Array(out.buffer));
  assert.equal(out.qrPlacements?.length, texts.length);
  // Первая страница: над таблицей справа от заголовка; продолжения —
  // таблица с верхнего поля, QR строк не отнимает.
  assert.deepEqual(
    out.qrPlacements?.map((p) => p.where),
    texts.map((_, index) => (index === 0 ? "corner" : "none")),
  );
  for (const text of texts) for (const part of COPYRIGHT_PARTS) assert.ok(text.includes(part), part);

  const cabinet = renderPaperJournalPdfDetailed(params);
  assert.equal(cabinet.qrPlacements, undefined);
  const cabinetTexts = await pageTexts(new Uint8Array(cabinet.buffer));
  assert.ok(cabinetTexts.every((text) => !text.includes("© WeSetup")), "кабинетный бланк без копирайта");
});

test("Word: копирайт и QR в подвале (повторяется на каждой странице)", async () => {
  const url = "https://wesetup.ru/qb/TESTTOKEN";
  const { buffer } = await renderJournalDocumentDocx(buildJournalSampleInput("hygiene"), "hygiene", {
    footer: { qrUrl: url, lines: BLANK_QR_LINES },
  });
  const zip = await JSZip.loadAsync(buffer);
  const document = await zip.file("word/document.xml")!.async("string");
  assert.match(document, /<w:footerReference w:type="default"/, "подвал подключён к разделу");
  const footerName = Object.keys(zip.files).find((name) => /^word\/footer\d*\.xml$/.test(name));
  assert.ok(footerName, "есть файл подвала");
  const footer = await zip.file(footerName!)!.async("string");
  assert.ok(footer.includes(BLANK_COPYRIGHT), "копирайт в подвале");
  assert.ok(footer.includes(BLANK_QR_CAPTION), "подпись QR в подвале");
  assert.match(footer, /<pic:pic|<a:blip/, "картинка QR в подвале");

  const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  assert.equal(media.length, 1);
  const png = await zip.file(media[0])!.async("nodebuffer");
  // Фирменная ч/б плитка (знак, коррекция H, полоса «Отсканировать») — как в шапке PDF шаблона.
  const expected = await brandQrPng(url, { width: 600 });
  assert.ok(png.equals(expected), "в подвале ровно QR этого адреса");
  // Размер в подвале: ширина 81 px Word ≈ 21,4 мм (модуль ≥ 0,365 мм у 53 модулей), высота — по пропорции плитки.
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(footer);
  assert.ok(extent, "размер картинки в подвале");
  const [cx, cy] = [Number(extent[1]), Number(extent[2])];
  assert.ok(Math.abs(cx / 36000 - 21.4) < 0.1, `ширина ${cx / 36000} мм`);
  assert.ok(Math.abs(cy / cx - expected.readUInt32BE(20) / expected.readUInt32BE(16)) < 0.02, "пропорция плитки");

  // Без подвала — файл как раньше.
  const plain = await JSZip.loadAsync((await renderJournalDocumentDocx(buildJournalSampleInput("hygiene"), "hygiene")).buffer);
  assert.equal(Object.keys(plain.files).some((name) => /^word\/footer\d*\.xml$/.test(name)), false);
});
