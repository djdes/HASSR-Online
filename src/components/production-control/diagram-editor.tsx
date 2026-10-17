"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  Maximize,
  MousePointer2,
  RectangleHorizontal,
  Route,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DIAGRAM_LIMITS, FLOW_KINDS, FLOW_STYLES, edgeAnchors, fitView, newDiagramId, nodeAt, snap } from "@/lib/ppk/diagram";
import type { DiagramData, DiagramEdge, DiagramNode, FlowKind } from "@/lib/ppk/records";
import { DiagramSvg, FlowLegend } from "@/components/production-control/diagram-svg";
import { PPK_FIELD_CLASS, PPK_LABEL_CLASS, PPK_SELECT_CLASS } from "@/components/production-control/ppk-ui";

type Tool = "select" | "step" | "connect" | "room" | "flow";
type Selection = { type: "node" | "edge"; id: string } | null;
type Pt = { x: number; y: number };
type Drag =
  | { mode: "move"; id: string; start: Pt; orig: Pt; pushed: boolean }
  | { mode: "resize"; id: string; start: Pt; orig: { w: number; h: number }; pushed: boolean }
  | { mode: "draw"; start: Pt }
  | { mode: "pan"; startClient: Pt; origin: Pt };

/** Масштаб кнопок «+» / «−»: от 0.25 до 3 (подгонка «По размеру» — от 0.5 до 1.5). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
const MAX_COORD = DIAGRAM_LIMITS.maxCoord;
const HISTORY_LIMIT = 50;
const NONE = "__none";
const STEP_W = 240;
const STEP_H = 56;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Связи блок-схемы привязаны к границам узлов: пересчитываем точки после правки. */
function withAnchors(data: DiagramData): DiagramData {
  let changed = false;
  const edges = data.edges.map((edge) => {
    if (!edge.from || !edge.to) return edge;
    const a = data.nodes.find((n) => n.id === edge.from);
    const b = data.nodes.find((n) => n.id === edge.to);
    if (!a || !b) return edge;
    changed = true;
    return { ...edge, points: edgeAnchors(a, b) };
  });
  return changed ? { ...data, edges } : data;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function Chip({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-40",
        active
          ? "border-[#5566f6]/40 bg-[#eef1ff] text-[#3848c7]"
          : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Редактор схем ППК на чистом SVG и pointer events: блок-схема техпроцесса
 * (этапы и связи) и план помещений с потоками. Данные приходят и уходят целиком
 * (`value` / `onChange`), сохранение — забота страницы.
 */
export function DiagramEditor({
  kind,
  value,
  onChange,
  areas = [],
  controlNumbers = [],
}: {
  kind: "flowchart" | "floor-plan";
  value: DiagramData;
  onChange: (data: DiagramData) => void;
  areas?: { id: string; name: string }[];
  controlNumbers?: string[];
}) {
  const t = useTranslations("productionControl.diagram");
  const svgRef = useRef<SVGSVGElement>(null);
  const idPrefix = "ed";

  const [tool, setTool] = useState<Tool>("select");
  const [flowKind, setFlowKind] = useState<FlowKind>("raw");
  const [selection, setSelection] = useState<Selection>(null);
  // Видимая область: левый верхний угол в координатах схемы и масштаб (пикселей на единицу).
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const [past, setPast] = useState<DiagramData[]>([]);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [draftFlow, setDraftFlow] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [draftRoom, setDraftRoom] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Размер холста: нужен для подгонки масштаба и для viewBox.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [narrow]);

  /** «По размеру»: вписать содержимое в холст (при открытии — один раз, когда известен размер). */
  const fit = useCallback(() => {
    if (size) setView(fitView(valueRef.current, size.w, size.h));
  }, [size]);
  useEffect(() => {
    if (size && !fitted.current) {
      fitted.current = true;
      setView(fitView(valueRef.current, size.w, size.h));
    }
  }, [size]);

  /** Приблизить или отдалить вокруг центра холста. */
  const zoomBy = useCallback(
    (factor: number) => {
      if (!size) return;
      setView((v) => {
        const scale = clamp(Math.round(v.scale * factor * 1000) / 1000, ZOOM_MIN, ZOOM_MAX);
        const cx = v.x + size.w / v.scale / 2;
        const cy = v.y + size.h / v.scale / 2;
        return { scale, x: cx - size.w / scale / 2, y: cy - size.h / scale / 2 };
      });
    },
    [size],
  );

  const pushHistory = useCallback(() => {
    setPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), valueRef.current]);
  }, []);

  /** Применить новую версию схемы; `record` — запомнить прежнюю для «Отменить». */
  const commit = useCallback(
    (next: DiagramData, record = true) => {
      if (record) pushHistory();
      const normalized = kind === "flowchart" ? withAnchors(next) : next;
      valueRef.current = normalized;
      onChange(normalized);
    },
    [kind, onChange, pushHistory],
  );

  const selectedNode = selection?.type === "node" ? value.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedEdge = selection?.type === "edge" ? value.edges.find((e) => e.id === selection.id) : undefined;

  const patchNode = (id: string, patch: Partial<DiagramNode>, record = true) =>
    commit({ ...valueRef.current, nodes: valueRef.current.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }, record);
  const patchEdge = (id: string, patch: Partial<DiagramEdge>, record = true) =>
    commit({ ...valueRef.current, edges: valueRef.current.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }, record);

  const removeSelected = useCallback(() => {
    if (!selection) return;
    const data = valueRef.current;
    if (selection.type === "node") {
      commit({
        ...data,
        nodes: data.nodes.filter((n) => n.id !== selection.id),
        edges: data.edges.filter((e) => e.from !== selection.id && e.to !== selection.id),
      });
    } else {
      commit({ ...data, edges: data.edges.filter((e) => e.id !== selection.id) });
    }
    setSelection(null);
    setEditingId(null);
  }, [commit, selection]);

  const undo = useCallback(() => {
    setPast((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      valueRef.current = last;
      onChange(last);
      return prev.slice(0, -1);
    });
    setSelection(null);
    setEditingId(null);
  }, [onChange]);

  const finishFlow = useCallback(() => {
    if (draftFlow.length >= 2) {
      const edge: DiagramEdge = {
        id: newDiagramId("f"),
        from: null,
        to: null,
        points: draftFlow,
        flow: flowKind,
        label: "",
      };
      commit({ ...valueRef.current, edges: [...valueRef.current.edges, edge] });
      setSelection({ type: "edge", id: edge.id });
    }
    setDraftFlow([]);
    setCursor(null);
  }, [commit, draftFlow, flowKind]);

  const chooseTool = useCallback((next: Tool) => {
    setTool(next);
    setConnectFrom(null);
    setDraftFlow([]);
    setDraftRoom(null);
    setCursor(null);
  }, []);

  // Клавиши: только когда фокус не в поле ввода. Обработчик всегда свежий.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const handleKey = (event: KeyboardEvent) => {
    if (narrow || isTypingTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (mod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "delete" || key === "backspace") {
      if (selection) {
        event.preventDefault();
        removeSelected();
      }
    } else if (key === "escape") {
      if (draftFlow.length > 0 || connectFrom || draftRoom) chooseTool(tool);
      else setSelection(null);
    } else if (key === "enter") {
      if (tool === "flow" && draftFlow.length > 0) {
        event.preventDefault();
        finishFlow();
      }
    } else if (key === "v") chooseTool("select");
    else if (kind === "flowchart" && key === "s") chooseTool("step");
    else if (kind === "flowchart" && key === "c") chooseTool("connect");
    else if (kind === "floor-plan" && key === "r") chooseTool("room");
  };
  useEffect(() => {
    keyRef.current = handleKey;
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /** Координаты указателя в системе viewBox. */
  const toPoint = (event: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (narrow || event.button > 0) return;
    const target = event.target as Element;
    const pt = toPoint(event);
    const nodeId = target.closest("[data-node]")?.getAttribute("data-node") ?? null;
    const edgeId = target.closest("[data-edge]")?.getAttribute("data-edge") ?? null;
    const resizeId = target.closest("[data-resize]")?.getAttribute("data-resize") ?? null;
    const data = valueRef.current;

    if (tool === "select") {
      if (resizeId) {
        const node = data.nodes.find((n) => n.id === resizeId);
        if (!node) return;
        dragRef.current = { mode: "resize", id: node.id, start: pt, orig: { w: node.w, h: node.h }, pushed: false };
        svgRef.current?.setPointerCapture(event.pointerId);
      } else if (nodeId) {
        const node = data.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        setSelection({ type: "node", id: nodeId });
        dragRef.current = { mode: "move", id: nodeId, start: pt, orig: { x: node.x, y: node.y }, pushed: false };
        svgRef.current?.setPointerCapture(event.pointerId);
      } else if (edgeId) {
        setSelection({ type: "edge", id: edgeId });
      } else {
        setSelection(null);
        setEditingId(null);
        // Пустое место: тянем холст.
        dragRef.current = { mode: "pan", startClient: { x: event.clientX, y: event.clientY }, origin: { x: view.x, y: view.y } };
        svgRef.current?.setPointerCapture(event.pointerId);
      }
    } else if (tool === "step") {
      if (nodeId) {
        setSelection({ type: "node", id: nodeId });
        return;
      }
      if (data.nodes.length >= DIAGRAM_LIMITS.nodes) {
        toast.error(t("limitNodes", { count: String(DIAGRAM_LIMITS.nodes) }));
        return;
      }
      const node: DiagramNode = {
        id: newDiagramId("n"),
        x: clamp(snap(pt.x - STEP_W / 2), 0, MAX_COORD - STEP_W),
        y: clamp(snap(pt.y - STEP_H / 2), 0, MAX_COORD - STEP_H),
        w: STEP_W,
        h: STEP_H,
        label: t("newStep"),
        kind: "step",
        ccp: null,
        areaId: null,
      };
      commit({ ...data, nodes: [...data.nodes, node] });
      setSelection({ type: "node", id: node.id });
    } else if (tool === "connect") {
      if (!nodeId) return;
      if (!connectFrom) {
        setConnectFrom(nodeId);
        return;
      }
      if (connectFrom !== nodeId && !data.edges.some((e) => e.from === connectFrom && e.to === nodeId)) {
        if (data.edges.length >= DIAGRAM_LIMITS.edges) {
          toast.error(t("limitEdges", { count: String(DIAGRAM_LIMITS.edges) }));
          setConnectFrom(null);
          return;
        }
        const edge: DiagramEdge = { id: newDiagramId("e"), from: connectFrom, to: nodeId, points: [], flow: null, label: "" };
        commit({ ...data, edges: [...data.edges, edge] });
        setSelection({ type: "edge", id: edge.id });
      }
      setConnectFrom(null);
    } else if (tool === "room") {
      if (data.nodes.length >= DIAGRAM_LIMITS.nodes) {
        toast.error(t("limitNodes", { count: String(DIAGRAM_LIMITS.nodes) }));
        return;
      }
      const start = { x: clamp(snap(pt.x), 0, MAX_COORD), y: clamp(snap(pt.y), 0, MAX_COORD) };
      dragRef.current = { mode: "draw", start };
      setDraftRoom({ x: start.x, y: start.y, w: 0, h: 0 });
      svgRef.current?.setPointerCapture(event.pointerId);
    } else if (tool === "flow") {
      const next = { x: clamp(snap(pt.x), 0, MAX_COORD), y: clamp(snap(pt.y), 0, MAX_COORD) };
      if (draftFlow.length >= DIAGRAM_LIMITS.points) {
        toast.error(t("limitPoints", { count: String(DIAGRAM_LIMITS.points) }));
        return;
      }
      setDraftFlow((prev) => {
        const last = prev[prev.length - 1];
        return last && last.x === next.x && last.y === next.y ? prev : [...prev, next];
      });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (narrow) return;
    const drag = dragRef.current;
    if (drag?.mode === "pan") {
      const dx = (event.clientX - drag.startClient.x) / view.scale;
      const dy = (event.clientY - drag.startClient.y) / view.scale;
      setView((v) => ({ ...v, x: drag.origin.x - dx, y: drag.origin.y - dy }));
      return;
    }
    const pt = toPoint(event);
    if (!drag) {
      if (tool === "flow" && draftFlow.length > 0) setCursor({ x: snap(pt.x), y: snap(pt.y) });
      return;
    }
    const dx = pt.x - drag.start.x;
    const dy = pt.y - drag.start.y;
    if (drag.mode === "draw") {
      const x = clamp(snap(pt.x), 0, MAX_COORD);
      const y = clamp(snap(pt.y), 0, MAX_COORD);
      const w = Math.min(Math.abs(x - drag.start.x), DIAGRAM_LIMITS.maxSize);
      const h = Math.min(Math.abs(y - drag.start.y), DIAGRAM_LIMITS.maxSize);
      setDraftRoom({ x: x < drag.start.x ? drag.start.x - w : drag.start.x, y: y < drag.start.y ? drag.start.y - h : drag.start.y, w, h });
      return;
    }
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && !drag.pushed) return;
    if (!drag.pushed) {
      pushHistory();
      drag.pushed = true;
    }
    const node = valueRef.current.nodes.find((n) => n.id === drag.id);
    if (!node) return;
    if (drag.mode === "move") {
      patchNode(
        drag.id,
        {
          x: clamp(snap(drag.orig.x + dx), 0, MAX_COORD - node.w),
          y: clamp(snap(drag.orig.y + dy), 0, MAX_COORD - node.h),
        },
        false,
      );
    } else {
      patchNode(
        drag.id,
        {
          w: clamp(snap(drag.orig.w + dx), DIAGRAM_LIMITS.minSize, Math.min(DIAGRAM_LIMITS.maxSize, MAX_COORD - node.x)),
          h: clamp(snap(drag.orig.h + dy), DIAGRAM_LIMITS.minSize, Math.min(DIAGRAM_LIMITS.maxSize, MAX_COORD - node.y)),
        },
        false,
      );
    }
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    if (drag?.mode === "draw" && draftRoom) {
      // Клик без протяжки — комната по умолчанию 200×120.
      const tiny = draftRoom.w < DIAGRAM_LIMITS.minSize || draftRoom.h < DIAGRAM_LIMITS.minSize;
      const rect = tiny
        ? { x: drag.start.x, y: drag.start.y, w: 200, h: 120 }
        : draftRoom;
      const node: DiagramNode = {
        id: newDiagramId("r"),
        x: clamp(rect.x, 0, MAX_COORD - rect.w),
        y: clamp(rect.y, 0, MAX_COORD - rect.h),
        w: rect.w,
        h: rect.h,
        label: t("newRoom"),
        kind: "room",
        ccp: null,
        areaId: null,
      };
      commit({ ...valueRef.current, nodes: [...valueRef.current.nodes, node] });
      setSelection({ type: "node", id: node.id });
      setDraftRoom(null);
      setTool("select");
    }
  };

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (narrow) return;
    if (tool === "flow") {
      finishFlow();
      return;
    }
    // Указатель захвачен svg, поэтому target — сам svg: узел определяем по координатам.
    const nodeId = nodeAt(valueRef.current, toPoint(event))?.id;
    if (tool === "select" && nodeId) {
      setSelection({ type: "node", id: nodeId });
      pushHistory();
      setEditingId(nodeId);
    }
  };

  const editingNode = editingId ? value.nodes.find((n) => n.id === editingId) : undefined;

  const flowLabels = Object.fromEntries(FLOW_KINDS.map((k) => [k, t(`flows.${k}`)])) as Record<FlowKind, string>;
  const hint =
    tool === "step" ? t("hintStep") : tool === "connect" ? t("hintConnect") : tool === "room" ? t("hintRoom") : tool === "flow" ? t("hintFlow") : t("hintSelect");

  const cursorClass =
    tool === "select" ? "cursor-grab" : tool === "connect" ? "cursor-pointer" : "cursor-crosshair";

  const ccpOptions = selectedNode?.ccp && !controlNumbers.includes(selectedNode.ccp) ? [...controlNumbers, selectedNode.ccp] : controlNumbers;

  return (
    <div className="space-y-4">
      {narrow ? (
        <div className="rounded-2xl border border-[#ececf4] bg-[#f5f6ff] px-4 py-3 text-[13.5px] text-[#3c4053]">
          {t("editOnDesktop")}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label={t("canvas")}>
            <Chip active={tool === "select"} onClick={() => chooseTool("select")} title="V">
              <MousePointer2 className="size-4" />
              {t("select")}
            </Chip>
            {kind === "flowchart" ? (
              <>
                <Chip active={tool === "step"} onClick={() => chooseTool("step")} title="S">
                  <Square className="size-4" />
                  {t("step")}
                </Chip>
                <Chip active={tool === "connect"} onClick={() => chooseTool("connect")} title="C">
                  <ArrowRight className="size-4" />
                  {t("connect")}
                </Chip>
              </>
            ) : (
              <>
                <Chip active={tool === "room"} onClick={() => chooseTool("room")} title="R">
                  <RectangleHorizontal className="size-4" />
                  {t("room")}
                </Chip>
                <Chip active={tool === "flow"} onClick={() => chooseTool("flow")}>
                  <Route className="size-4" />
                  {t("flow")}
                </Chip>
              </>
            )}
            <Chip onClick={removeSelected} disabled={!selection} title="Delete">
              <Trash2 className="size-4" />
              {t("remove")}
            </Chip>
            <Chip onClick={undo} disabled={past.length === 0} title="Ctrl+Z">
              <Undo2 className="size-4" />
              {t("undo")}
            </Chip>
            <span className="mx-1 hidden h-9 w-px bg-[#ececf4] sm:block" />
            <Chip onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={view.scale <= ZOOM_MIN} title={t("zoomOut")}>
              <ZoomOut className="size-4" />
              <span className="sr-only">{t("zoomOut")}</span>
            </Chip>
            <Chip onClick={() => zoomBy(ZOOM_STEP)} disabled={view.scale >= ZOOM_MAX} title={t("zoomIn")}>
              <ZoomIn className="size-4" />
              <span className="sr-only">{t("zoomIn")}</span>
            </Chip>
            <Chip onClick={fit}>
              <Maximize className="size-4" />
              {t("fit")}
            </Chip>
          </div>

          {tool === "flow" ? (
            <div className="flex flex-wrap items-center gap-2">
              {FLOW_KINDS.map((k) => (
                <Chip key={k} active={flowKind === k} onClick={() => setFlowKind(k)}>
                  <span
                    className="h-1 w-5 rounded-full"
                    style={{ background: FLOW_STYLES[k].color }}
                    aria-hidden="true"
                  />
                  {flowLabels[k]}
                </Chip>
              ))}
              {draftFlow.length >= 2 ? (
                <button
                  type="button"
                  onClick={finishFlow}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <Check className="size-4" />
                  {t("finishFlow")}
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="text-[13px] text-[#6f7282]">{hint}</p>
        </div>
      )}

      {editingNode && !narrow ? (
        <input
          autoFocus
          value={editingNode.label}
          maxLength={120}
          aria-label={t("editLabel")}
          onChange={(event) => patchNode(editingNode.id, { label: event.target.value }, false)}
          onBlur={() => setEditingId(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") setEditingId(null);
          }}
          className={PPK_FIELD_CLASS}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div
          ref={canvasRef}
          className="h-[70vh] min-h-[420px] min-w-0 overflow-hidden rounded-3xl border border-[#ececf4] bg-[#fafbff]"
        >
          <DiagramSvg
            data={value}
            kind={kind}
            idPrefix={idPrefix}
            viewBox={`${view.x} ${view.y} ${size ? size.w / view.scale : 1600} ${size ? size.h / view.scale : 1000}`}
            grid
            svgRef={svgRef}
            svgProps={{
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              onDoubleClick,
              style: { width: "100%", height: "100%", touchAction: "none" },
            }}
            selectedNodeId={selection?.type === "node" ? selection.id : null}
            selectedEdgeId={selection?.type === "edge" ? selection.id : null}
            className={cn("block select-none", cursorClass)}
          >
            {/* Слой событий и черновиков поверх схемы. */}
            {selectedNode && tool === "select" && !narrow ? (
              <rect
                data-resize={selectedNode.id}
                x={selectedNode.x + selectedNode.w - 8}
                y={selectedNode.y + selectedNode.h - 8}
                width={16}
                height={16}
                rx={4}
                fill="#5566f6"
                stroke="#fff"
                strokeWidth={2}
                className="cursor-nwse-resize"
              />
            ) : null}
            {connectFrom ? (
              (() => {
                const n = value.nodes.find((x) => x.id === connectFrom);
                return n ? (
                  <rect x={n.x - 4} y={n.y - 4} width={n.w + 8} height={n.h + 8} rx={14} fill="none" stroke="#5566f6" strokeWidth={3} strokeDasharray="8 5" pointerEvents="none" />
                ) : null;
              })()
            ) : null}
            {draftRoom ? (
              <rect x={draftRoom.x} y={draftRoom.y} width={draftRoom.w} height={draftRoom.h} fill="#5566f6" fillOpacity={0.08} stroke="#5566f6" strokeWidth={2.5} strokeDasharray="8 5" pointerEvents="none" />
            ) : null}
            {draftFlow.length > 0 ? (
              <polyline
                points={[...draftFlow, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={FLOW_STYLES[flowKind].color}
                strokeWidth={3}
                strokeDasharray="6 5"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ) : null}
          </DiagramSvg>
        </div>

        {!narrow ? (
          <aside className="rounded-3xl border border-[#ececf4] bg-white p-4">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">{t("selected")}</div>
            {selectedNode ? (
              <div className="space-y-4">
                <label className="block">
                  <span className={PPK_LABEL_CLASS}>{t("label")}</span>
                  <input
                    value={selectedNode.label}
                    maxLength={120}
                    onFocus={pushHistory}
                    onChange={(event) => patchNode(selectedNode.id, { label: event.target.value }, false)}
                    className={PPK_FIELD_CLASS}
                  />
                </label>
                {selectedNode.kind === "step" ? (
                  <div>
                    <span className={PPK_LABEL_CLASS}>{t("isCcp")}</span>
                    {controlNumbers.length === 0 && !selectedNode.ccp ? (
                      <p className="text-[13px] text-[#6f7282]">
                        {t("noCcp")}.{" "}
                        <Link href="/production-control/haccp/control-points" className="font-medium text-[#3848c7] hover:text-[#5566f6]">
                          {t("toCcp")}
                        </Link>
                      </p>
                    ) : (
                      <Select
                        value={selectedNode.ccp ?? NONE}
                        onValueChange={(v) => patchNode(selectedNode.id, { ccp: v === NONE ? null : v })}
                      >
                        <SelectTrigger className={PPK_SELECT_CLASS}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{t("ccpNone")}</SelectItem>
                          {ccpOptions.map((number) => (
                            <SelectItem key={number} value={number}>
                              {number}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ) : (
                  <div>
                    <span className={PPK_LABEL_CLASS}>{t("fromAreas")}</span>
                    <Select
                      value={selectedNode.areaId ?? NONE}
                      onValueChange={(v) => {
                        const area = areas.find((a) => a.id === v);
                        patchNode(selectedNode.id, v === NONE || !area ? { areaId: null } : { areaId: area.id, label: area.name.slice(0, 120) });
                      }}
                    >
                      <SelectTrigger className={PPK_SELECT_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("areaNone")}</SelectItem>
                        {areas.map((area) => (
                          <SelectItem key={area.id} value={area.id}>
                            {area.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            ) : selectedEdge ? (
              <div className="space-y-4">
                {kind === "floor-plan" ? (
                  <div>
                    <span className={PPK_LABEL_CLASS}>{t("flowKind")}</span>
                    <div className="flex flex-wrap gap-2">
                      {FLOW_KINDS.map((k) => (
                        <Chip key={k} active={selectedEdge.flow === k} onClick={() => patchEdge(selectedEdge.id, { flow: k })}>
                          <span className="h-1 w-5 rounded-full" style={{ background: FLOW_STYLES[k].color }} aria-hidden="true" />
                          {flowLabels[k]}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
                <label className="block">
                  <span className={PPK_LABEL_CLASS}>{t("label")}</span>
                  <input
                    value={selectedEdge.label}
                    maxLength={120}
                    onFocus={pushHistory}
                    onChange={(event) => patchEdge(selectedEdge.id, { label: event.target.value }, false)}
                    className={PPK_FIELD_CLASS}
                  />
                </label>
              </div>
            ) : (
              <p className="text-[13.5px] text-[#6f7282]">{t("nothingSelected")}</p>
            )}
          </aside>
        ) : null}
      </div>

      {kind === "floor-plan" ? <FlowLegend title={t("legend")} labels={flowLabels} /> : null}
    </div>
  );
}
