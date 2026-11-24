/**
 * Черновик оргструктуры (пункт 1.2 структуры ППК) из должностей кабинета:
 * руководитель сверху, должности руководства вторым рядом, персонал — ниже.
 * Связей подчинения в системе нет, поэтому персонал привязан к первой
 * должности руководства (или к руководителю) — черновик правится в
 * редакторе. Чистый модуль: без БД и React.
 */
import { edgeAnchors } from "./diagram";
import type { DiagramData, DiagramEdge, DiagramNode } from "./records";

export type OrgChartPosition = { name: string; category: "management" | "staff" };

const NODE_W = 220;
const NODE_H = 60;
const STEP_X = 260;
const STEP_Y = 140;
const TOP = 40;
const LEFT = 40;
/** Должностей в одном ряду: шире лист A4 альбомом не читается. */
const PER_ROW = 6;
/** Должностей в черновике: схема держит до 150 блоков. */
const MAX_POSITIONS = 120;

const clip = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 120);

/** Ряды должностей по `PER_ROW`; каждый ряд центрируется по самому широкому. */
function rows<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += PER_ROW) out.push(items.slice(i, i + PER_ROW));
  return out;
}

export function orgChartFromPositions(params: {
  title: string;
  head: string;
  positions: OrgChartPosition[];
}): DiagramData {
  const seen = new Set<string>();
  const head = clip(params.head) || "Руководитель";
  seen.add(head.toLowerCase());
  const unique = params.positions
    .map((position) => ({ ...position, name: clip(position.name) }))
    .filter((position) => {
      const key = position.name.toLowerCase();
      if (!position.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_POSITIONS);
  const management = unique.filter((position) => position.category === "management");
  const staff = unique.filter((position) => position.category === "staff");

  const layout: { name: string; level: number }[][] = [
    [{ name: head, level: 0 }],
    ...rows(management).map((row) => row.map((position) => ({ name: position.name, level: 1 }))),
    ...rows(staff).map((row) => row.map((position) => ({ name: position.name, level: 2 }))),
  ];
  const widest = Math.max(...layout.map((row) => row.length));

  const nodes: (DiagramNode & { level: number })[] = [];
  layout.forEach((row, rowIndex) => {
    const offset = ((widest - row.length) * STEP_X) / 2;
    row.forEach((cell, index) => {
      nodes.push({
        id: `n${nodes.length + 1}`,
        x: LEFT + offset + index * STEP_X,
        y: TOP + rowIndex * STEP_Y,
        w: NODE_W,
        h: NODE_H,
        label: cell.name,
        kind: "step",
        ccp: null,
        areaId: null,
        level: cell.level,
      });
    });
  });

  const top = nodes[0];
  const firstManager = nodes.find((node) => node.level === 1) ?? null;
  const edges: DiagramEdge[] = [];
  for (const node of nodes) {
    if (node.level === 0) continue;
    const parent = node.level === 1 ? top : (firstManager ?? top);
    const [a, b] = edgeAnchors(parent, node);
    edges.push({ id: `e${edges.length + 1}`, from: parent.id, to: node.id, points: [a, b], flow: null, label: "" });
  }

  return {
    title: clip(params.title),
    nodes: nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      label: node.label,
      kind: node.kind,
      ccp: node.ccp,
      areaId: node.areaId,
    })),
    edges,
  };
}
