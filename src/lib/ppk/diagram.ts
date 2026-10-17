/**
 * Чистые помощники редактора схем ППК: сетка, точки связей на границах
 * прямоугольников, шаблоны блок-схем, цвета потоков и подсчёт для карточек.
 */
import type { DiagramData, DiagramEdge, DiagramNode, FlowKind } from "./records";

export const FLOW_KINDS: FlowKind[] = ["raw", "ready", "waste", "staff", "dishes"];

/** Стиль потока на плане: цвет и штрих (`dash` — значение `stroke-dasharray`). */
export const FLOW_STYLES: Record<FlowKind, { color: string; dash: string | null }> = {
  raw: { color: "#b26a2b", dash: null },
  ready: { color: "#1f9d55", dash: null },
  waste: { color: "#d1453b", dash: "10 6" },
  staff: { color: "#3d6ff2", dash: "2 6" },
  dishes: { color: "#7b7f93", dash: "10 6" },
};

/** Привязка значения к сетке. */
export function snap(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}

/** Точка на границе прямоугольника узла по линии, идущей к точке `toward`. */
function boundaryPoint(node: DiagramNode, toward: { x: number; y: number }) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : node.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : node.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: Math.round(cx + dx * t), y: Math.round(cy + dy * t) };
}

/** Начало и конец связи: точки на границах узлов по линии центров. */
export function edgeAnchors(
  from: DiagramNode,
  to: DiagramNode,
): [{ x: number; y: number }, { x: number; y: number }] {
  const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  return [boundaryPoint(from, toCenter), boundaryPoint(to, fromCenter)];
}

const TEMPLATE_STEPS = {
  hot: [
    "Приёмка сырья",
    "Хранение сырья",
    "Размораживание",
    "Первичная обработка",
    "Тепловая обработка",
    "Охлаждение",
    "Хранение готовой продукции",
    "Раздача",
  ],
  cold: [
    "Приёмка",
    "Хранение",
    "Мойка и обработка овощей",
    "Нарезка",
    "Сборка блюд",
    "Хранение готовой продукции",
    "Раздача",
  ],
  pastry: [
    "Приёмка",
    "Хранение",
    "Подготовка сырья",
    "Замес",
    "Формовка",
    "Выпечка",
    "Охлаждение",
    "Отделка",
    "Хранение",
    "Реализация",
  ],
} as const;

export type FlowchartTemplate = keyof typeof TEMPLATE_STEPS;

/** Готовая блок-схема цеха: этапы сверху вниз с шагом 96, связаны по порядку. */
export function flowchartTemplate(name: FlowchartTemplate): DiagramData {
  const nodes: DiagramNode[] = TEMPLATE_STEPS[name].map((label, i) => ({
    id: `s${i + 1}`,
    x: 360,
    y: 40 + i * 96,
    w: 240,
    h: 56,
    label,
    kind: "step",
    ccp: null,
    areaId: null,
  }));
  const edges: DiagramEdge[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const [a, b] = edgeAnchors(nodes[i], nodes[i + 1]);
    edges.push({ id: `e${i + 1}`, from: nodes[i].id, to: nodes[i + 1].id, points: [a, b], flow: null, label: "" });
  }
  return { title: "", nodes, edges };
}

/** Сводка для карточки схемы. */
export function diagramStats(data: DiagramData): { steps: number; rooms: number; flows: number } {
  return {
    steps: data.nodes.filter((n) => n.kind === "step").length,
    rooms: data.nodes.filter((n) => n.kind === "room").length,
    flows: data.edges.filter((e) => e.flow !== null).length,
  };
}

/** Рамка содержимого с полями — для печати и превью (viewBox по размеру схемы). */
export function diagramBounds(data: DiagramData, pad = 40): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of data.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y - 12);
    maxX = Math.max(maxX, n.x + n.w + 8);
    maxY = Math.max(maxY, n.y + n.h);
  }
  for (const e of data.edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 800, h: 500 };
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.max(200, maxX - minX + pad * 2),
    h: Math.max(120, maxY - minY + pad * 2),
  };
}

/** Лимиты сервера (`records.ts`): редактор не даёт их превысить, иначе сохранение вернёт 400. */
export const DIAGRAM_LIMITS = { nodes: 150, edges: 300, points: 50, minSize: 40, maxSize: 2000, maxCoord: 4000 } as const;

/** Узел под точкой схемы (верхний из перекрывающихся) или `null`. */
export function nodeAt(data: DiagramData, point: { x: number; y: number }): DiagramNode | null {
  for (let i = data.nodes.length - 1; i >= 0; i--) {
    const n = data.nodes[i];
    if (point.x >= n.x && point.x <= n.x + n.w && point.y >= n.y && point.y <= n.y + n.h) return n;
  }
  return null;
}

/**
 * Масштаб и сдвиг (левый верхний угол видимой области в координатах схемы),
 * при которых содержимое с отступом 40 помещается в холст `cw × ch` пикселей.
 * Масштаб — от 0.5 до 1.5; пустая схема — 1 из начала координат.
 */
export function fitView(data: DiagramData, cw: number, ch: number): { x: number; y: number; scale: number } {
  if (data.nodes.length === 0 && data.edges.length === 0) return { x: 0, y: 0, scale: 1 };
  const box = diagramBounds(data, 40);
  const raw = Math.min(cw / box.w, ch / box.h);
  const scale = Math.min(1.5, Math.max(0.5, raw));
  const viewW = cw / scale;
  const viewH = ch / scale;
  // Если содержимое шире (выше) видимой области — выравниваем по краю, иначе по центру.
  const x = box.w >= viewW ? box.x : box.x + box.w / 2 - viewW / 2;
  const y = box.h >= viewH ? box.y : box.y + box.h / 2 - viewH / 2;
  return { x, y, scale };
}

/** Новый короткий id узла или связи. */
export function newDiagramId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export type { DiagramData };

/**
 * Подписи этапов всех блок-схем: узлы `step` каждой схемы сверху вниз, без пустых и
 * повторов (без учёта регистра), в порядке схем.
 */
export function flowchartStepLabels(charts: Pick<DiagramData, "nodes">[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chart of charts) {
    const steps = chart.nodes.filter((node) => node.kind === "step").sort((a, b) => a.y - b.y || a.x - b.x);
    for (const node of steps) {
      const label = node.label.trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}
