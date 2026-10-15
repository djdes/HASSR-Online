import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { columnsFromHeaderLabels, findHeaderLabels } from "./journal-column-templates";
import { createColumnSample, sampleColumnAliases, sampleColumnLabels } from "./journal-column-sample";
import { JOURNAL_COLUMN_CODES, getColumnRegistry, resolveColumns } from "./journal-columns";

test("downloaded sample workbooks round-trip all standard column IDs without storing translated captions", async () => {
  for (const code of JOURNAL_COLUMN_CODES) {
    const expected = resolveColumns(code, {}).filter(column => !column.hidden && !column.unavailable).map(column => column.key);
    const aliases = await sampleColumnAliases(code);
    for (const locale of ["ru", "en", "uz"] as const) {
      const created = await createColumnSample(code, locale);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await created.xlsx.writeBuffer());
      const sheet = workbook.worksheets[0];
      const grid: string[][] = [];
      sheet.eachRow(row => {
        const cells: string[] = [];
        row.eachCell(cell => cells.push(cell.text));
        grid.push(cells);
      });
      const headers = findHeaderLabels(grid);
      assert.equal(headers.length, expected.length);
      if (locale !== "ru") assert.doesNotMatch(sheet.name + headers.join(" "), /\p{Script=Cyrillic}/u, `${code}/${locale}`);
      const imported = columnsFromHeaderLabels(code, headers, aliases);
      assert.deepEqual(imported.matched.map(column => column.key), expected, `${code}/${locale}`);
      assert.deepEqual(imported.custom, []);
      assert.deepEqual(imported.columns.labels, {}, "downloaded translation must not become a saved custom label");
      assert.deepEqual(imported.columns.order?.slice(0, expected.length), expected);
    }
  }
});

test("every registry column has unambiguous cross-locale aliases, including long headers; custom labels remain unchanged", async () => {
  for (const code of JOURNAL_COLUMN_CODES) {
    const aliases = await sampleColumnAliases(code);
    for (const locale of ["ru", "en", "uz"] as const) {
      const labels = await sampleColumnLabels(code, locale);
      for (const column of getColumnRegistry(code)) {
        const imported = columnsFromHeaderLabels(code, [labels[column.key]], aliases);
        assert.equal(imported.matched[0]?.key, column.key, `${code}/${locale}/${column.key}`);
        assert.deepEqual(imported.columns.labels, {});
      }
      const custom = columnsFromHeaderLabels(code, ["Моя графа O‘tkir"], aliases);
      assert.deepEqual(custom.custom, ["Моя графа O‘tkir"]);
      assert.equal(custom.columns.custom?.[0].label, "Моя графа O‘tkir");
    }
  }
});
