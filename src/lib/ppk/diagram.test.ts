import test from "node:test";
import assert from "node:assert/strict";

import {
  flowchartStepLabels,
  DIAGRAM_LIMITS,
  DOOR_WIDTH,
  FLOW_KINDS,
  FLOW_STYLES,
  diagramBounds,
  doorAt,
  doorBounds,
  doorSwingVector,
  fitView,
  nodeAt,
  diagramStats,
  edgeAnchors,
  flowchartTemplate,
  snap,
  snapDoorToWall,
  type DiagramData,
} from "./diagram";
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
  assert.equal(Object.keys(FLOW_STYLES).length, 7);
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

test("flowchartStepLabels: этапы схем сверху вниз, без помещений, пустых и повторов", () => {
  const node = (label: string, y: number, kind: "step" | "room" = "step") => ({ id: label + y, x: 0, y, w: 10, h: 10, label, kind, ccp: null, areaId: null });
  const charts = [
    { nodes: [node("Нарезка", 100), node("Приёмка", 0), node("Цех", 50, "room"), node(" ", 20)] },
    { nodes: [node("приёмка", 0), node("Выдача", 10)] },
  ];
  assert.deepEqual(flowchartStepLabels(charts), ["Приёмка", "Нарезка", "Выдача"]);
});

test("потоки: вода и канализация — свои цвета и штрих, не как у других", () => {
  assert.deepEqual(FLOW_KINDS, ["raw", "ready", "waste", "staff", "dishes", "water", "sewage"]);
  const styles = FLOW_KINDS.map((k) => `${FLOW_STYLES[k].color}|${FLOW_STYLES[k].dash}`);
  assert.equal(new Set(styles).size, styles.length);
  const colors = FLOW_KINDS.map((k) => FLOW_STYLES[k].color);
  assert.equal(new Set(colors).size, colors.length);
  const room = node("a", 0, 0, "room");
  const plan = (flow: string) => ({
    title: "П",
    nodes: [room],
    edges: [{ id: "e", from: null, to: null, points: [{ x: 1, y: 1 }, { x: 50, y: 1 }], flow, label: "" }],
  });
  assert.equal(PPK_RECORD_SCHEMAS["floor-plan"].safeParse(plan("water")).success, true);
  assert.equal(PPK_RECORD_SCHEMAS["floor-plan"].safeParse(plan("sewage")).success, true);
  assert.equal(PPK_RECORD_SCHEMAS["floor-plan"].safeParse(plan("steam")).success, false);
});

const room = (id: string, x: number, y: number, w = 200, h = 120) => ({ ...node(id, x, y, "room"), w, h });
const door = (over: object = {}) => ({ id: "d1", kind: "door" as const, x: 100, y: 0, w: 40, angle: 0 as const, flip: false, label: "", ...over });

test("snapDoorToWall: дверь встаёт на ближайшую стену по её направлению", () => {
  const rooms = [room("a", 0, 0)];
  // У верхней стены: на стене, шаг 10, поворот 0.
  assert.deepEqual(snapDoorToWall(rooms, { x: 63, y: 12 }, 40), { x: 60, y: 0, angle: 0 });
  // У правой стены: вертикально.
  assert.deepEqual(snapDoorToWall(rooms, { x: 190, y: 57 }, 40), { x: 200, y: 60, angle: 90 });
  // Сторона открывания сохраняется на стене той же оси.
  assert.deepEqual(snapDoorToWall(rooms, { x: 100, y: 118 }, 40, 180), { x: 100, y: 120, angle: 180 });
  assert.deepEqual(snapDoorToWall(rooms, { x: 4, y: 60 }, 40, 270), { x: 0, y: 60, angle: 270 });
  // Ось сменилась — поворот по стене.
  assert.deepEqual(snapDoorToWall(rooms, { x: 4, y: 60 }, 40, 180), { x: 0, y: 60, angle: 90 });
  // Не выходит за угол.
  assert.deepEqual(snapDoorToWall(rooms, { x: 5, y: 2 }, 40), { x: 20, y: 0, angle: 0 });
  // Далеко от стен — null; этапы блок-схемы — не стены.
  assert.equal(snapDoorToWall(rooms, { x: 100, y: 60 }, 40), null);
  assert.equal(snapDoorToWall([node("s", 0, 0)], { x: 10, y: 0 }, 40), null);
  // Из двух стен — ближайшая.
  const two = [room("a", 0, 0), room("b", 0, 200)];
  assert.deepEqual(snapDoorToWall(two, { x: 100, y: 190 }, 40), { x: 100, y: 200, angle: 0 });
  // Короткая стена — посередине.
  assert.deepEqual(snapDoorToWall([room("c", 0, 0, 40, 40)], { x: 3, y: 1 }, 60), { x: 20, y: 0, angle: 0 });
});

test("doorBounds: проём вдоль стены, полотно — в сторону открывания", () => {
  assert.deepEqual(doorSwingVector(0), { x: 0, y: -1 });
  assert.deepEqual(doorSwingVector(90), { x: 1, y: 0 });
  assert.deepEqual(doorSwingVector(180), { x: 0, y: 1 });
  assert.deepEqual(doorSwingVector(270), { x: -1, y: 0 });
  // Вдоль стены — запас 6 с каждой стороны, как у зоны нажатия значка.
  assert.deepEqual(doorBounds(door()), { x: 74, y: -46, w: 52, h: 52 });
  assert.deepEqual(doorBounds(door({ angle: 180 })), { x: 74, y: -6, w: 52, h: 52 });
  assert.deepEqual(doorBounds(door({ angle: 90, x: 200, y: 60 })), { x: 194, y: 34, w: 52, h: 52 });
  assert.deepEqual(doorBounds(door({ angle: 270, x: 0, y: 60 })), { x: -46, y: 34, w: 52, h: 52 });
  assert.deepEqual(doorBounds(door({ kind: "opening" })), { x: 74, y: -6, w: 52, h: 12 });
  const plan: DiagramData = { title: "", nodes: [room("a", 0, 100)], edges: [], doors: [door({ y: 100 })] };
  assert.equal(doorAt(plan, { x: 100, y: 80 })?.id, "d1");
  assert.equal(doorAt(plan, { x: 100, y: 150 }), null);
  assert.equal(doorAt(plan, { x: 123, y: 98 })?.id, "d1", "у края проёма — тоже дверь");
  // Рамка схемы учитывает дверь (полотно выше помещения).
  assert.equal(diagramBounds(plan, 0).y, 54);
  // Дверь у верхней стены помещения у края холста: полотно в минусе — рамка его не обрезает.
  const edge: DiagramData = { title: "", nodes: [room("a", 0, 20)], edges: [], doors: [door({ y: 20 })] };
  assert.equal(diagramBounds(edge, 40).y, -26 - 40);
  assert.equal(diagramBounds({ title: "", nodes: [room("a", 0, 20)], edges: [] }, 40).y, 0, "без двери — как раньше");
});

test("схема плана: двери и проёмы — необязательные, с пределами", () => {
  const nodes = [room("a", 0, 0)];
  const parse = (doors?: unknown[]) =>
    PPK_RECORD_SCHEMAS["floor-plan"].safeParse({ title: "П", nodes, edges: [], ...(doors ? { doors } : {}) });
  // Старый план без дверей — как был.
  const old = parse();
  assert.equal(old.success, true);
  assert.equal("doors" in (old.data as object), false);
  const ok = parse([door(), door({ id: "d2", kind: "opening", angle: 90, flip: true })]);
  assert.equal(ok.success, true);
  assert.equal((ok.data as DiagramData).doors?.length, 2);
  assert.equal(parse([door({ kind: "window" })]).success, false);
  assert.equal(parse([door({ angle: 45 })]).success, false);
  assert.equal(parse([door({ w: DOOR_WIDTH.min - 1 })]).success, false);
  assert.equal(parse([door({ w: DOOR_WIDTH.max + 1 })]).success, false);
  assert.equal(parse([door({ x: -1 })]).success, false);
  assert.equal(parse([door(), door()]).success, false);
  assert.equal(parse(Array.from({ length: DIAGRAM_LIMITS.doors + 1 }, (_, i) => door({ id: `d${i}` }))).success, false);
  // У блок-схемы дверей нет.
  const chart = flowchartTemplate("hot");
  assert.equal(PPK_RECORD_SCHEMAS.flowchart.safeParse({ ...chart, doors: [door()] }).success, false);
  assert.equal(PPK_RECORD_SCHEMAS.flowchart.safeParse({ ...chart, doors: [] }).success, true);
});
