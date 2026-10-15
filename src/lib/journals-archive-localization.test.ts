import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { loadMessages } from "@/i18n/messages";
import type { buildJournalsArchive } from "./journals-archive";

const require = createRequire(import.meta.url);
const from = new Date("2026-10-01T00:00:00Z"), to = new Date("2026-10-31T23:59:59.999Z");
const rawData = { temperature: -7.25, isWithinNorm: false, signature: "Подписал O‘tkir", equipmentId: "Холодильник №1", legacy: "non_compliant", nested: { raw: "Исходное" }, "custom:own": "=1+1", empty: null };

function archiveFixture(count = 3, customNames = true, templateName = "Температурный режим") {
  const queries: { type: string; query: Record<string, unknown> }[] = [];
  const pdfCalls: { documentId: string; organizationId: string; locale: string }[] = [];
  const fields = [{ key: "temperature", label: "Customer thermometer" }, { key: "equipmentId", label: "Оборудование" }];
  const rows = [{ organizationId: "active-org", date: new Date("2026-10-15T23:30:00Z"), employee: { name: "Автор O‘tkir" }, data: rawData }, { organizationId: "foreign-org", date: from, employee: { name: "FOREIGN" }, data: { leak: "FOREIGN" } }];
  const db = {
    journalDocument: { findMany: async (query: Record<string, unknown>) => { queries.push({ type: "documents", query }); return Array.from({ length: count }, (_, index) => ({ id: `doc-${index}`, title: "Customer title", dateFrom: from, dateTo: to, config: { columns: { labels: { temperature: "Custom column °C" }, custom: [{ key: "custom:own", label: "Свой столбец", type: "text" }] } }, template: { code: "temp_control", name: templateName, fields } })); } },
    journalDocumentEntry: { findMany: async (query: { where: { document: { organizationId: string } } }) => { queries.push({ type: "documentEntries", query }); return rows.filter(row => row.organizationId === query.where.document.organizationId); } },
    journalEntry: { findMany: async (query: Record<string, unknown>) => { queries.push({ type: "fieldEntries", query }); return [{ createdAt: from, data: rawData, templateId: "template-1", filledById: "user-1" }, { createdAt: from, data: { note: "Unchanged foreign reference" }, templateId: "template-1", filledById: "foreign-user" }]; } },
    journalTemplate: { findMany: async (query: Record<string, unknown>) => { queries.push({ type: "templates", query }); return [{ id: "template-1", code: "temp_control", name: templateName, fields }]; } },
    user: { findMany: async (query: { where: { organizationId: string } }) => { queries.push({ type: "users", query }); return [{ id: "user-1", name: "Автор O‘tkir", organizationId: "active-org" }, { id: "foreign-user", name: "FOREIGN USER", organizationId: "foreign-org" }].filter(user => user.organizationId === query.where.organizationId); } },
  };
  const fixtureModule = { exports: {} as { buildJournalsArchive: typeof buildJournalsArchive } };
  const compiled = ts.transpileModule(readFileSync("src/lib/journals-archive.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const execute = vm.runInThisContext(`(function(require, module, exports, Buffer) { ${compiled}\n})`);
  execute((id: string) => {
      if (id === "@/lib/db") return { db };
      if (id === "@/lib/org-custom-names") return { getOrgCustomNames: async (organizationId: string) => { assert.equal(organizationId, "active-org"); return { journals: customNames ? { temp_control: "Custom journal O‘tkir" } : {}, sections: {} }; } };
      if (id === "@/lib/document-pdf") return { generateJournalDocumentPdf: async (input: { documentId: string; organizationId: string; locale: string }) => { pdfCalls.push(input); if (input.documentId === "doc-2") throw new Error("RAW TECHNICAL SECRET"); return { buffer: Buffer.from(`PDF ${input.documentId} ${input.locale}`) }; } };
      return require(id);
    }, fixtureModule, fixtureModule.exports, Buffer);
  return { build: fixtureModule.exports.buildJournalsArchive, queries, pdfCalls };
}

test("actual ZIP/XLSX preserve raw backup cells, custom labels and colliding documents across RU/EN/UZ", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const fixture = archiveFixture();
    const result = await fixture.build("active-org", from, to, locale);
    assert.deepEqual([result.documents, result.fieldJournals, result.truncated], [3, 1, false]);
    const zip = await JSZip.loadAsync(result.zip);
    const messages = await loadMessages(locale), copy = messages.archiveExport;
    const files = Object.keys(zip.files).filter(key => !zip.files[key].dir);
    assert.ok(files.includes(`${copy.files.documents}/2026-10-01 Customer title.pdf`));
    assert.ok(files.includes(`${copy.files.documents}/2026-10-01 Customer title (2).pdf`));
    assert.equal(fixture.pdfCalls.length, 3);
    for (const call of fixture.pdfCalls) assert.deepEqual({ ...call, documentId: "ignored" }, { documentId: "ignored", organizationId: "active-org", locale });
    assert.equal(await zip.file(`${copy.files.documents}/2026-10-01 Customer title (3) — ${copy.files.pdfFailedSuffix}.txt`)!.async("string"), copy.files.pdfFailed);
    const readme = await zip.file(copy.files.readme)!.async("string");
    assert.ok(readme.includes("2026-10-01") && readme.includes("2026-10-31") && readme.includes(copy.files.documents));
    assert.ok(!readme.includes("RAW TECHNICAL"));
    for (const file of files.filter(name => name.endsWith(".xlsx"))) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await zip.file(file)!.async("arraybuffer"));
      const sheet = workbook.worksheets[0], fieldSheet = workbook.worksheets[1];
      assert.equal(sheet.name, "Custom journal O‘tkir");
      const headers = (sheet.getRow(1).values as unknown[]).slice(1);
      assert.equal(headers[0], copy.files.date); assert.equal(headers[1], copy.files.who);
      assert.equal(headers[2], file.startsWith(copy.files.documents) ? "Custom column °C" : "Customer thermometer");
      assert.equal(headers[3], messages.journalFields.temp_control.isWithinNorm.label);
      assert.equal(headers[5], messages.journalFields.temp_control.equipmentId.label);
      const values = (sheet.getRow(2).values as unknown[]).slice(1);
      assert.deepEqual(values, [file.startsWith(copy.files.documents) ? "2026-10-15" : "2026-10-01", "Автор O‘tkir", -7.25, false, "Подписал O‘tkir", "Холодильник №1", "non_compliant", JSON.stringify(rawData.nested), "=1+1", "", ...(file.startsWith(copy.files.documents) ? [] : [""])]);
      assert.equal(fieldSheet.getCell("A2").value, "temperature");
      assert.equal(fieldSheet.getCell("B2").value, headers[2]);
      assert.equal(sheet.rowCount, file.startsWith(copy.files.documents) ? 2 : 3);
      if (!file.startsWith(copy.files.documents)) assert.equal(sheet.getCell("B3").value, "");
      assert.ok(!JSON.stringify(sheet.getSheetValues()).includes("FOREIGN USER"));
    }
    const documentQuery = fixture.queries.find(query => query.type === "documents")!.query;
    assert.deepEqual(JSON.parse(JSON.stringify(documentQuery.where)), { organizationId: "active-org", dateFrom: { lte: to.toISOString() }, dateTo: { gte: from.toISOString() } });
    assert.equal(documentQuery.take, 201);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.queries.find(query => query.type === "fieldEntries")!.query.where)), { organizationId: "active-org", createdAt: { gte: from.toISOString(), lte: to.toISOString() } });
  }
});

test("built-in archive journal names translate while edited template names and default-RU callers remain compatible", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const custom of [false, true]) {
      const original = custom ? "Customer template name" : "Температурный режим";
      const fixture = archiveFixture(0, false, original);
      const archive = await fixture.build("active-org", from, to, locale);
      const zip = await JSZip.loadAsync(archive.zip);
      const messages = await loadMessages(locale);
      const expected = custom ? original : messages.journals.names.temp_control;
      const file = Object.keys(zip.files).find(name => name.endsWith(".xlsx"))!;
      assert.ok(file.includes(expected), file);
    }
  }
  const archive = await archiveFixture(0).build("active-org", from, to);
  assert.ok((await JSZip.loadAsync(archive.zip)).file("ЧИТАЙ.txt"));
});

test("archive truncation remains 200 documents and records a localized warning", async () => {
  const fixture = archiveFixture(201);
  const result = await fixture.build("active-org", from, to, "en");
  assert.equal(result.documents, 200); assert.equal(result.truncated, true); assert.equal(fixture.pdfCalls.length, 200);
  const zip = await JSZip.loadAsync(result.zip);
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith(".xlsx")).length, 201);
  assert.match(await zip.file("README.txt")!.async("string"), /first 200 documents/);
});
