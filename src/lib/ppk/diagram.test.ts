import test from "node:test";
import assert from "node:assert/strict";

import { DIAGRAM_LIMITS, FLOW_STYLES, diagramBounds, fitView, nodeAt, diagramStats, edgeAnchors, flowchartTemplate, snap, type DiagramData } from "./diagram";
import { PPK_RECORD_BLOCKS, PPK_RECORD_LIMITS, PPK_RECORD_SCHEMAS } from "./records";

const node = (id: string, x: number, y: number, kind: "step" | "room" = "step") => ({
  id, x, y, w: 240, h: 56, label: id, kind, ccp: null, areaId: null,
});

test("snap: к сетке 20, шаг можно задать", () => {
  assert.equal(snap(29), 20);
  assert.equal(snap(31), 40);
  assert.equal(snap(0), 0);
  assert.equal(snap(47, 50), 50);
});

test("edgeAnchors: точки на границах по линии центров", () => {
  const a = node("a", 0, 0);
  const b = node("b", 0, 200);
  const [p, q] = edgeAnchors(a, b);
  assert.deepEqual(p, { x: 120, y: 56 });
  assert.deepEqual(q, { x: 120, y: 200 });
  const c = node("c", 400, 0);
  const [p2, q2] = edgeAnchors(a, c);
  assert.deepEqual(p2, { x: 240, y: 28 });
  assert.deepEqual(q2, { x: 400, y: 28 });
});

test("flowchartTemplate: этапы сверху вниз, шаг 96, связи по порядку", () => {
  const hot = flowchartTemplate("hot");
  assert.equal(hot.nodes.length, 8);
  assert.equal(hot.nodes[0].label, "Приёмка сырья");
  assert.equal(hot.nodes[7].label, "Раздача");
  assert.equal(hot.nodes[1].y - hot.nodes[0].y, 96);
  assert.equal(hot.nodes[0].w, 240);
  assert.equal(hot.nodes[0].h, 56);
  assert.equal(hot.edges.length, 7);
  assert.equal(hot.edges[0].from, hot.nodes[0].id);
  assert.equal(hot.edges[0].to, hot.nodes[1].id);
  assert.equal(flowchartTemplate("cold").nodes.length, 7);
  assert.equal(flowchartTemplate("pastry").nodes.length, 10);
  for (const name of ["hot", "cold", "pastry"] as const) {
    assert.equal(PPK_RECORD_SCHEMAS.flowchart.safeParse(flowchartTemplate(name)).success, true);
  }
});

test("diagramStats: этапы, помещения, потоки", () => {
  const data: DiagramData = {
    title: "t",
    nodes: [node("a", 0, 0), node("b", 0, 100, "room"), node("c", 0, 200, "room")],
    edges: [
      { id: "e1", from: null, to: null, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], flow: "raw", label: "" },
      { id: "e2", from: "a", to: "b", points: [], flow: null, label: "" },
    ],
  };
  assert.deepEqual(diagramStats(data), { steps: 1, rooms: 2, flows: 1 });
  assert.equal(Object.keys(FLOW_STYLES).length, 5);
});

test("блоки схем: лимиты по 50", () => {
  assert.ok(PPK_RECORD_BLOCKS.includes("flowchart"));
  assert.ok(PPK_RECORD_BLOCKS.includes("floor-plan"));
  assert.equal(PPK_RECORD_LIMITS.flowchart, 50);
  assert.equal(PPK_RECORD_LIMITS["floor-plan"], 50);
});

test("схема блок-схемы: связи ссылаются на узлы схемы", () => {
  const base = { title: "Схема", nodes: [node("a", 0, 0), node("b", 0, 100)] };
  const good = { ...base, edges: [{ id: "e", from: "a", to: "b", points: [], flow: null, label: "" }] };
  const bad = { ...base, edges: [{ id: "e", from: "a", to: "zzz", points: [], flow: null, label: "" }] };
  assert.equal(PPK_RECORD_SCHEMAS.flowchart.safeParse(good).success, true);
  assert.equal(PPK_RECORD_SCHEMAS.flowchart.safeParse(bad).success, false);
  const room = { ...base, nodes: [node("a", 0, 0, "room")], edges: [] };
  assert.equal(PPK_RECORD_SCHEMAS.flowchart.safeParse(room).success, false);
});

test("схема плана: ломаная от 2 точек с потоком, пределы координат", () => {
  const rooms = [node("a", 0, 0, "room"), node("b", 300, 0, "room")];
  const pts = [{ x: 10, y: 10 }, { x: 100, y: 10 }];
  const edge = (over: object) => ({ id: "e", from: null, to: null, points: pts, flow: "raw", label: "", ...over });
  const ok = (edges: unknown[], nodes = rooms) =>
    PPK_RECORD_SCHEMAS["floor-plan"].safeParse({ title: "П", nodes, edges }).success;
  assert.equal(ok([edge({})]), true);
  assert.equal(ok([edge({ points: [pts[0]] })]), false);
  assert.equal(ok([edge({ flow: null })]), false);
  assert.equal(ok([edge({ points: [{ x: -1, y: 0 }, { x: 5, y: 5 }] })]), false);
  assert.equal(ok([], [{ ...rooms[0], w: 30 }]), false);
  assert.equal(ok([], [{ ...rooms[0], kind: "step" as never }]), false);
  assert.equal(ok([edge({ points: Array.from({ length: 51 }, () => ({ x: 1, y: 1 })) })]), false);
  assert.equal(ok([edge({ label: "x".repeat(121) })]), false);
});

test("diagramBounds: рамка с полями, пустая схема — запасная", () => {
  const b = diagramBounds({ title: "", nodes: [node("a", 100, 100)], edges: [] }, 20);
  assert.deepEqual(b, { x: 80, y: 68, w: 288, h: 120 });
  assert.equal(diagramBounds({ title: "", nodes: [], edges: [] }).w, 800);
});

test("nodeAt: узел под точкой, верхний из перекрывающихся, пусто — null", () => {
  const data: DiagramData = {
    title: "",
    nodes: [node("a", 0, 0), { ...node("b", 100, 20), w: 100, h: 100 }],
    edges: [],
  };
  assert.equal(nodeAt(data, { x: 10, y: 10 })?.id, "a");
  assert.equal(nodeAt(data, { x: 150, y: 50 })?.id, "b");
  assert.equal(nodeAt(data, { x: 150, y: 30 })?.id, "b");
  assert.equal(nodeAt(data, { x: 500, y: 500 }), null);
});

test("fitView: пустая схема — масштаб 1; содержимое вписывается в пределах 0.5…1.5", () => {
  assert.deepEqual(fitView({ title: "", nodes: [], edges: [] }, 900, 600), { x: 0, y: 0, scale: 1 });
  const small: DiagramData = { title: "", nodes: [node("a", 100, 100)], edges: [] };
  assert.equal(fitView(small, 900, 600).scale, 1.5);
  const big: DiagramData = { title: "", nodes: [node("a", 0, 0), node("b", 3000, 3000)], edges: [] };
  assert.equal(fitView(big, 900, 600).scale, 0.5);
  const hot = flowchartTemplate("hot");
  const v = fitView(hot, 900, 700);
  assert.ok(v.scale >= 0.8 && v.scale <= 1.5);
  // Содержимое целиком в видимой области.
  const box = diagramBounds(hot);
  assert.ok(v.x <= box.x + 1 && v.y <= box.y + 1);
  assert.ok(v.x + 900 / v.scale >= box.x + box.w - 1 && v.y + 700 / v.scale >= box.y + box.h - 1);
});

test("clampDiagram: лимиты сервера по размерам и координатам", () => {
  assert.equal(DIAGRAM_LIMITS.nodes, 150);
  assert.equal(DIAGRAM_LIMITS.edges, 300);
  assert.equal(DIAGRAM_LIMITS.points, 50);
});
