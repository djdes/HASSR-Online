import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import JSZip from "jszip";
import { createTranslator } from "use-intl/core";
import type { Messages } from "@/i18n/messages";
import { HYGIENE_STATUS_OPTIONS } from "@/lib/hygiene-document";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { formatDate, type Locale } from "@/i18n/locales";

type DocxModule = typeof import("./document-docx");
type BrandModule = typeof import("./brand-qr");
const sourceRoot = process.env.DOCX_SAMPLE_SOURCE_ROOT;
const batch = path.resolve(".agent/tasks/english-version-1375e736/batches/docx-samples");
const artifacts = process.env.DOCX_SAMPLE_ARTIFACT_DIR;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const requireModule = createRequire(import.meta.url);
const locales: Locale[] = ["ru", "en", "uz"];

function messagesFor(locale: Locale): Messages {
  const messages = JSON.parse(fs.readFileSync(path.resolve(`src/i18n/messages/${locale}.json`), "utf8"));
  if (sourceRoot) {
    const patch = JSON.parse(fs.readFileSync(path.join(batch, `${locale}.json`), "utf8"));
    messages.docxSample = patch.docxSample;
    messages.journalPdf = { ...messages.journalPdf, ...patch.journalPdf };
  }
  return messages as Messages;
}

function loadModule(file: string, overrides: Record<string, unknown>): Record<string, unknown> {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { exports, module: { exports }, require: (name: string) => Object.hasOwn(overrides, name) ? overrides[name] : requireModule(name), Buffer, Uint8Array, console, process }, { filename: file });
  return exports;
}

const runtime = (async () => {
  if (!sourceRoot) return { docx: await import("./document-docx"), brand: await import("./brand-qr") };
  const copy = loadModule(path.join(sourceRoot, "i18n/journal-docx-copy.ts"), { "./messages": { loadMessages: async (locale: Locale) => messagesFor(locale) } });
  const brand = loadModule(path.join(sourceRoot, "lib/brand-qr.ts"), { "@/i18n/journal-pdf-copy": { journalPdfCopy: (locale: Locale) => createTranslator({ locale, messages: messagesFor(locale).journalPdf }) } }) as unknown as BrandModule;
  const docx = loadModule(path.join(sourceRoot, "lib/document-docx.ts"), { "@/i18n/journal-docx-copy": copy, "@/lib/brand-qr": brand }) as unknown as DocxModule;
  return { docx, brand };
})();

function xmlText(xml: string): string[] {
  const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const names: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    return names[entity] ?? String.fromCodePoint(parseInt(entity.slice(entity[2] === "x" ? 3 : 2, -1), entity[2] === "x" ? 16 : 10));
  });
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => decode(match[1]));
}

function tableCells(xml: string): string[][][] {
  return [...xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)].map((table) =>
    [...table[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((row) =>
      [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((cell) => xmlText(cell[1]).join(""))));
}

const registerKeys = {
  cleaning: ["date", "room", "cleaningType", "agent", "performer", "signature"],
  finished_product: ["dateTime", "dish", "organoleptic", "permission", "commission", "signature"],
  incoming_control: ["date", "supplier", "product", "batch", "expiry", "temperature", "documents", "decision", "fullName"],
} as const;

for (const locale of locales) for (const footerEnabled of [false, true]) {
  test(`actual six DOCX bodies/columns/styles/footer and original data: ${locale}, footer=${footerEnabled}`, async () => {
    const { docx, brand } = await runtime;
    const messages = messagesFor(locale);
    const t = createTranslator({ locale, messages: messages.docxSample });
    for (const code of docx.DOCX_SAMPLE_CODES) {
      const input = buildJournalSampleInput(code);
      input.locale = locale;
      input.document.title = "Должность O‘g‘il & <Sarlavha> — very long custom journal title ".repeat(3);
      const original = JSON.stringify(input);
      const url = "https://wesetup.ru/qb/DOCX_FIXTURE";
      const lines = ["Custom footer O‘g‘il & <line>", "Custom copyright «Документ»"];
      const output = await docx.renderJournalDocumentDocx(input, code, footerEnabled ? { footer: { qrUrl: url, lines } } : {});
      assert.equal(output.fileName, `obrazec-${code}.docx`);
      assert.ok(output.buffer.length > 7000);
      assert.equal(JSON.stringify(input), original, "renderer must not mutate supplied data");
      const zip = await JSZip.loadAsync(output.buffer);
      const xml = await zip.file("word/document.xml")!.async("string");
      const text = xmlText(xml);
      assert.ok(text.includes(input.document.title.toUpperCase()));
      assert.ok(text.includes(t("system")));
      assert.ok(text.includes(t("finished")));
      assert.ok(text.includes(t("pages", { current: "1", total: "1" })));
      assert.ok(text.includes(t("sampleNotice")));
      const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const date = formatDate(locale, input.document.dateFrom, localZone, { day: "2-digit", month: "2-digit", year: "numeric" });
      assert.ok(text.includes(t("started", { date })));
      assert.ok(text.includes([input.document.organization.name, t("taxId", { number: input.document.organization.inn! }), input.document.organization.address].join(" · ")));
      if (locale !== "ru") for (const forbidden of [messagesFor("ru").docxSample.system, messagesFor("ru").docxSample.sampleNotice, "СТР. 1 ИЗ 1"]) assert.ok(!text.includes(forbidden), forbidden);
      const tables = tableCells(xml);
      assert.equal(tables.length, 2);
      assert.equal(tables[0].length, 1); assert.equal(tables[0][0].length, 3);
      const body = tables[1];
      if (code === "hygiene" || code === "health_check") {
        assert.equal(body.length, input.users.length + 1);
        assert.deepEqual(body[0], [t("employeeName"), t("position"), ...Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, "0"))]);
        for (const user of input.users) { assert.ok(text.includes(user.name)); assert.ok(text.includes(user.positionTitle)); }
      } else if (code === "cold_equipment_control") {
        assert.equal(body.length, input.equipment.length + 1); assert.equal(body[0].length, 15); assert.equal(body[0][0], t("equipment"));
        for (const item of input.equipment) assert.ok(text.includes(item.name));
      } else {
        assert.equal(body.length, 13);
        assert.deepEqual(body[0], registerKeys[code].map((key) => t(`columns.${key}`)));
        assert.ok(body.slice(1).every((row) => row.length === body[0].length && row.every((value) => value === "")));
      }
      const styles = await zip.file("word/styles.xml")!.async("string");
      assert.ok(styles.includes(docx.DOCX_FONT));
      for (const source of [xml, styles]) for (const color of source.matchAll(/<w:color\b[^>]*\bw:val="([\da-f]{6})"/gi)) {
        assert.equal(color[1].slice(0, 2), color[1].slice(2, 4));
        assert.equal(color[1].slice(0, 2), color[1].slice(4, 6));
      }
      const footerNames = Object.keys(zip.files).filter((name) => /^word\/footer\d*\.xml$/.test(name));
      assert.equal(footerNames.length, footerEnabled ? 1 : 0);
      if (footerEnabled) {
        const footer = await zip.file(footerNames[0])!.async("string");
        assert.deepEqual(xmlText(footer), lines);
        assert.match(footer, /w:tblLayout w:type="fixed"/);
        assert.match(footer, /w:gridCol w:w="7426"/); assert.match(footer, /w:gridCol w:w="1600"/);
        assert.ok(footer.includes(t("qrAlt")));
        const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
        assert.equal(media.length, 1);
        const png = await zip.file(media[0])!.async("nodebuffer");
        assert.ok(png.equals(await brand.brandQrPng(url, { width: 600, locale })));
        if (artifacts && code === "hygiene") fs.writeFileSync(path.join(artifacts, `${locale}-qr.png`), png);
      }
      if (artifacts) fs.writeFileSync(path.join(artifacts, `${locale}-${code}${footerEnabled ? "-footer" : ""}.docx`), output.buffer);
    }
  });
}

test("canonical status codes, unknown values and signature precedence preserve stored records", async () => {
  const { docx } = await runtime;
  for (const locale of locales) {
    const input = buildJournalSampleInput("hygiene"); input.locale = locale;
    const user = input.users[0]; input.users = [user];
    const values = [...HYGIENE_STATUS_OPTIONS.map(({ value }) => ({ status: value })), { status: "Свой статус & <Ω>", signed: true }, { signed: true }, {}, { status: "__proto__" }, { status: "" }];
    const source = input.document.entries[0];
    input.document.entries = values.map((data, index) => ({ ...source, id: `status-${index}`, employeeId: user.id, date: new Date(Date.UTC(2026, 3, index + 1)), data }));
    const before = JSON.stringify(input);
    const output = await docx.renderJournalDocumentDocx(input, "hygiene");
    const zip = await JSZip.loadAsync(output.buffer);
    const body = tableCells(await zip.file("word/document.xml")!.async("string"))[1];
    const codes = messagesFor(locale).journalControls.walkthroughs.previews;
    assert.deepEqual(body[1].slice(2, 12), [codes.healthyCode, codes.dayOffCode, codes.sickLeaveCode, codes.suspendedCode, codes.vacationCode, "Свой статус & <Ω>", messagesFor(locale).docxSample.signatureMark, "✓", "__proto__", ""]);
    assert.equal(JSON.stringify(input), before);
    if (locale === "ru") assert.deepEqual(body[1].slice(2, 7), HYGIENE_STATUS_OPTIONS.map((item) => item.code));
  }
});

test("small temperature readings and zeros are not rounded or converted by locale", async () => {
  const { docx } = await runtime;
  for (const locale of locales) {
    const input = buildJournalSampleInput("cold_equipment_control"); input.locale = locale;
    const item = input.equipment[0]; input.equipment = [item];
    const original = input.document.entries[0];
    input.document.entries = [0, -0.000012345, 0.000012345, null].map((value, index) => ({ ...original, date: new Date(Date.UTC(2026, 3, index + 1)), data: { temperatures: { [item.id]: value } } }));
    const output = await docx.renderJournalDocumentDocx(input, "cold_equipment_control");
    const zip = await JSZip.loadAsync(output.buffer);
    const row = tableCells(await zip.file("word/document.xml")!.async("string"))[1][1];
    assert.deepEqual(row.slice(1, 5), ["0", "-0.000012345", "0.000012345", ""]);
  }
});

test("custom titles, employee/position/equipment names identical to Russian labels remain original", async () => {
  const { docx } = await runtime;
  for (const locale of locales) for (const code of ["hygiene", "cold_equipment_control"] as const) {
    const input = buildJournalSampleInput(code); input.locale = locale;
    const title = messagesFor("ru").journals.names[code]; input.document.title = title;
    input.users = [{ ...input.users[0], name: "Ф.И.О. работника", positionTitle: "Должность" }];
    input.equipment = [{ ...input.equipment[0], name: "Оборудование" }];
    const before = JSON.stringify(input);
    const output = await docx.renderJournalDocumentDocx(input, code);
    const zip = await JSZip.loadAsync(output.buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    assert.ok(xmlText(xml).includes(title.toUpperCase()));
    const row = tableCells(xml)[1][1];
    if (code === "hygiene") assert.deepEqual(row.slice(0, 2), ["Ф.И.О. работника", "Должность"]);
    else assert.equal(row[0], "Оборудование");
    assert.equal(JSON.stringify(input), before);
  }
});

test("QR locale changes only caption text; defaultRU and caption=false geometry/matrix stay compatible", async () => {
  const { brand } = await runtime;
  for (const url of ["https://wesetup.ru/qb/DOCX_FIXTURE", "https://wesetup.ru/qb/" + "A".repeat(120)]) {
    const base = brand.brandQrLayout(url);
    const expected = messagesFor("ru").journalPdf.qrScanCaption;
    assert.equal(expected, brand.BRAND_QR_CAPTION_TITLE);
    for (const locale of locales) {
      const localized = brand.brandQrLayout(url, { locale });
      assert.equal(localized.title!.text, messagesFor(locale).journalPdf.qrScanCaption);
      for (const key of ["url", "errorCorrection", "version", "size", "quiet", "frame", "width", "height", "window", "block", "strip", "pad", "mark"] as const) assert.deepEqual(localized[key], base[key]);
      for (let row = 0; row < base.size; row++) for (let col = 0; col < base.size; col++) {
        assert.equal(localized.dark(row, col), base.dark(row, col));
        assert.equal(localized.plain(row, col), base.plain(row, col));
      }
      assert.equal(localized.title!.size, base.title!.size);
      assert.equal(localized.title!.x, base.title!.x); assert.equal(localized.title!.y, base.title!.y);
      assert.equal(brand.brandQrLayout(url, { locale, caption: false }).title, null);
    }
    assert.ok((await brand.brandQrPng(url)).equals(await brand.brandQrPng(url, { locale: "ru" })));
  }
});
