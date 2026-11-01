import assert from "node:assert/strict";
import test from "node:test";

import { formatLosses1cCsv } from "./losses-1c-export";

// Аудит 2026-11-01: еженедельный CSV списаний для 1С был один на всю
// организацию без точки — а в 1С списание проводится по складу точки.

const record = {
  date: new Date("2026-10-30T00:00:00.000Z"),
  category: "Порча",
  productName: "Молоко",
  quantity: 1.5,
  unit: "л",
  costRub: 120,
  cause: "Срок",
  point: "Точка Б",
};

test("без точек — прежние колонки", () => {
  const { csv, rowCount, totalSumKopecks } = formatLosses1cCsv([record]);
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines[0], "Дата;Категория;Продукт;Кол-во;Ед.изм;Сумма (₽);Причина");
  assert.equal(lines[1], "30.10.2026;Порча;Молоко;1,5;л;120,00;Срок");
  assert.equal(rowCount, 1);
  assert.equal(totalSumKopecks, 12000);
});

test("по точкам — «Точка» последней колонкой", () => {
  const { csv } = formatLosses1cCsv([record], (r) => r.point);
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines[0], "Дата;Категория;Продукт;Кол-во;Ед.изм;Сумма (₽);Причина;Точка");
  assert.equal(lines[1], "30.10.2026;Порча;Молоко;1,5;л;120,00;Срок;Точка Б");
});
