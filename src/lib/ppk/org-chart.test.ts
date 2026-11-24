import { test } from "node:test";
import assert from "node:assert/strict";
import { orgChartFromPositions } from "./org-chart";
import { PPK_RECORD_SCHEMAS } from "./records";

test("черновик оргструктуры: руководитель → руководство → персонал, схема проходит проверку", () => {
  const chart = orgChartFromPositions({
    title: "Организационная структура",
    head: "Генеральный директор",
    positions: [
      { name: "Управляющий", category: "management" },
      { name: "Шеф-повар", category: "management" },
      { name: "Повар", category: "staff" },
      { name: "Официант", category: "staff" },
      { name: "повар", category: "staff" },
      { name: "Генеральный директор", category: "management" },
      { name: "  ", category: "staff" },
    ],
  });
  assert.deepEqual(
    chart.nodes.map((node) => node.label),
    ["Генеральный директор", "Управляющий", "Шеф-повар", "Повар", "Официант"],
  );
  const byLabel = new Map(chart.nodes.map((node) => [node.label, node.id]));
  const parentOf = (label: string) => chart.edges.find((edge) => edge.to === byLabel.get(label))?.from;
  assert.equal(parentOf("Управляющий"), byLabel.get("Генеральный директор"));
  assert.equal(parentOf("Шеф-повар"), byLabel.get("Генеральный директор"));
  // Персонал — к первой должности руководства (черновик правится в редакторе).
  assert.equal(parentOf("Повар"), byLabel.get("Управляющий"));
  assert.equal(chart.edges.length, chart.nodes.length - 1);
  assert.equal(PPK_RECORD_SCHEMAS["org-chart"].safeParse(chart).success, true);
});

test("без должностей руководства персонал подчинён руководителю; много должностей — ряды по 6", () => {
  const positions = Array.from({ length: 13 }, (_, index) => ({ name: `Должность ${index + 1}`, category: "staff" as const }));
  const chart = orgChartFromPositions({ title: "", head: "", positions });
  assert.equal(chart.nodes[0].label, "Руководитель");
  assert.ok(chart.edges.every((edge) => edge.from === chart.nodes[0].id));
  const rowsY = new Set(chart.nodes.slice(1).map((node) => node.y));
  assert.equal(rowsY.size, 3);
  assert.ok(chart.nodes.every((node) => node.x >= 0 && node.x + node.w <= 4000 && node.y + node.h <= 4000));
  assert.equal(PPK_RECORD_SCHEMAS["org-chart"].safeParse(chart).success, true);
});

test("предел блоков схемы соблюдается даже при сотнях должностей", () => {
  const positions = Array.from({ length: 400 }, (_, index) => ({ name: `Должность ${index}`, category: "staff" as const }));
  const chart = orgChartFromPositions({ title: "Большая", head: "Директор", positions });
  assert.ok(chart.nodes.length <= 150);
  assert.equal(PPK_RECORD_SCHEMAS["org-chart"].safeParse(chart).success, true);
});
