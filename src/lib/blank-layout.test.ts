import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBlankExtras } from "@/lib/blank-download-extras";
import { blankLayoutAdminLine, defaultBlankLayout, normalizeBlankLayout } from "@/lib/blank-layout";

test("default layout: journal columns where known, generic otherwise", () => {
  assert.equal(defaultBlankLayout("cleaning", "Журнал уборки").columns[1], "Помещение / зона");
  assert.deepEqual(defaultBlankLayout("unknown", "X").columns, ["Дата", "Содержание записи", "Ответственный", "Подпись"]);
  assert.equal(defaultBlankLayout("cleaning", "Журнал уборки").rows, 20);
});

test("normalize: trims, drops empty columns, clamps rows and sizes", () => {
  const layout = normalizeBlankLayout({
    title: "  Мой\n журнал  ",
    columns: ["Дата", "  ", "x".repeat(80), ...Array.from({ length: 20 }, (_, i) => `К${i}`)],
    rows: 500,
  });
  assert.ok(layout);
  assert.equal(layout.title, "Мой журнал");
  assert.equal(layout.columns.length, 12);
  assert.equal(layout.columns[1].length, 40);
  assert.equal(layout.rows, 60);
  assert.equal(normalizeBlankLayout({ title: "T", columns: ["A", "B"], rows: 1 })?.rows, 5);
});

test("normalize: invalid input → null", () => {
  assert.equal(normalizeBlankLayout(null), null);
  assert.equal(normalizeBlankLayout([]), null);
  assert.equal(normalizeBlankLayout({ title: "", columns: ["A", "B"], rows: 10 }), null);
  assert.equal(normalizeBlankLayout({ title: "T", columns: ["A"], rows: 10 }), null);
  assert.equal(normalizeBlankLayout({ title: "T", columns: ["A", "B"], rows: "10" }), null);
});

test("layout travels inside blank extras for any journal and shows in admin line", () => {
  const extras = normalizeBlankExtras({ layout: { title: "Свой", columns: ["A", "B", "C"], rows: 15 } }, "cleaning");
  assert.deepEqual(extras, { layout: { title: "Свой", columns: ["A", "B", "C"], rows: 15 } });
  assert.equal(blankLayoutAdminLine(extras?.layout), "🧩 Свой бланк: «Свой», колонок — 3, строк — 15");
  assert.equal(blankLayoutAdminLine(null), null);
});
