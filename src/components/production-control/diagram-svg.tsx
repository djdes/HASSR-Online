import type { ReactNode, Ref, SVGProps } from "react";
import { FLOW_KINDS, FLOW_STYLES, edgeAnchors } from "@/lib/ppk/diagram";
import type { DiagramData, DiagramEdge, DiagramNode, FlowKind } from "@/lib/ppk/records";

/*
 * Отрисовка схемы чистым SVG без интерактива: ею пользуются редактор (поверх
 * неё рисуются выделение и черновики), мини-превью карточек и печатные листы.
 */

const STEP_STROKE = "#dcdfed";
const ROOM_STROKE = "#3c4053";
const ARROW_COLOR = "#6f7282";

/** Точки ломаной связи: у блок-схемы — по границам узлов, у плана — свои. */
export function edgePoints(edge: DiagramEdge, nodes: DiagramNode[]): { x: number; y: number }[] {
  if (edge.from && edge.to) {
    const a = nodes.find((n) => n.id === edge.from);
    const b = nodes.find((n) => n.id === edge.to);
    if (a && b) return edgeAnchors(a, b);
  }
  return edge.points;
}

function pointsAttr(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Определения стрелок: по одной на цвет, id с префиксом (на странице несколько схем). */
export function DiagramDefs({ idPrefix }: { idPrefix: string }) {
  const colors: [string, string][] = [
    ["link", ARROW_COLOR],
    ...FLOW_KINDS.map((kind): [string, string] => [kind, FLOW_STYLES[kind].color]),
  ];
  return (
    <defs>
      {colors.map(([key, color]) => (
        <marker
          key={key}
          id={`${idPrefix}-arrow-${key}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}

/** Точечная сетка 20px: фон холста. */
export function DiagramGrid({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <pattern id={`${idPrefix}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="#dcdfed" />
      </pattern>
      <rect x="0" y="0" width="4000" height="4000" fill={`url(#${idPrefix}-grid)`} />
    </>
  );
}

function StepNode({ node, selected }: { node: DiagramNode; selected: boolean }) {
  const badgeWidth = node.ccp ? Math.max(40, 16 + node.ccp.length * 9) : 0;
  return (
    <g data-node={node.id}>
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={12}
        fill="#fff"
        stroke={selected ? "#5566f6" : STEP_STROKE}
        strokeWidth={selected ? 3 : 1.5}
      />
      <foreignObject x={node.x + 8} y={node.y} width={Math.max(0, node.w - 16)} height={node.h}>
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontSize: 18,
            lineHeight: 1.2,
            color: "#0b1024",
            overflow: "hidden",
            wordBreak: "break-word",
            fontFamily: "inherit",
          }}
        >
          {node.label}
        </div>
      </foreignObject>
      {node.ccp ? (
        <g>
          <rect x={node.x + node.w - badgeWidth + 8} y={node.y - 12} width={badgeWidth} height={24} rx={12} fill="#d1453b" />
          <text
            x={node.x + node.w - badgeWidth / 2 + 8}
            y={node.y + 5}
            textAnchor="middle"
            fontSize={13}
            fontWeight={700}
            fill="#fff"
          >
            {node.ccp}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function RoomNode({ node, selected }: { node: DiagramNode; selected: boolean }) {
  return (
    <g data-node={node.id}>
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={6}
        fill="#fff"
        fillOpacity={0.92}
        stroke={selected ? "#5566f6" : ROOM_STROKE}
        strokeWidth={selected ? 3.5 : 2.5}
      />
      <foreignObject x={node.x + 8} y={node.y + 6} width={Math.max(0, node.w - 16)} height={Math.max(0, node.h - 12)}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.2,
            color: "#0b1024",
            overflow: "hidden",
            wordBreak: "break-word",
            height: "100%",
            fontFamily: "inherit",
          }}
        >
          {node.label}
        </div>
      </foreignObject>
    </g>
  );
}

/**
 * Схема целиком: помещения/этапы и связи/потоки. `onlyFlow` оставляет на плане
 * один вид потока (печать по потокам); `selected` подсвечивает элемент.
 */
export function DiagramSvg({
  data,
  kind,
  idPrefix,
  viewBox,
  grid = false,
  onlyFlow,
  selectedNodeId,
  selectedEdgeId,
  className,
  svgRef,
  svgProps,
  children,
}: {
  data: DiagramData;
  kind: "flowchart" | "floor-plan";
  idPrefix: string;
  viewBox: string;
  grid?: boolean;
  onlyFlow?: FlowKind;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  className?: string;
  /** Для редактора: ссылка на элемент и обработчики указателя. */
  svgRef?: Ref<SVGSVGElement>;
  svgProps?: SVGProps<SVGSVGElement>;
  children?: ReactNode;
}) {
  const edges = data.edges.filter((e) => !onlyFlow || e.flow === onlyFlow);
  return (
    <svg ref={svgRef} viewBox={viewBox} className={className} {...svgProps} role="img" aria-label={data.title || undefined} xmlns="http://www.w3.org/2000/svg">
      <DiagramDefs idPrefix={idPrefix} />
      {grid ? <DiagramGrid idPrefix={idPrefix} /> : null}

      {kind === "floor-plan" ? data.nodes.map((n) => <RoomNode key={n.id} node={n} selected={n.id === selectedNodeId} />) : null}

      {edges.map((edge) => {
        const points = edgePoints(edge, data.nodes);
        if (points.length < 2) return null;
        const style = edge.flow ? FLOW_STYLES[edge.flow] : null;
        const color = style?.color ?? ARROW_COLOR;
        const selected = edge.id === selectedEdgeId;
        const last = points[points.length - 1];
        const first = points[0];
        return (
          <g key={edge.id} data-edge={edge.id}>
            {/* Широкая прозрачная линия — удобная зона для клика и касания. */}
            <polyline points={pointsAttr(points)} fill="none" stroke="transparent" strokeWidth={22} data-edge-hit={edge.id} />
            {selected ? (
              <polyline points={pointsAttr(points)} fill="none" stroke="#5566f6" strokeOpacity={0.25} strokeWidth={12} strokeLinejoin="round" />
            ) : null}
            <polyline
              points={pointsAttr(points)}
              fill="none"
              stroke={color}
              strokeWidth={kind === "floor-plan" ? 3 : 2}
              strokeDasharray={style?.dash ?? undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              markerEnd={`url(#${idPrefix}-arrow-${edge.flow ?? "link"})`}
            />
            {edge.label ? (
              <text
                x={(first.x + last.x) / 2 + 8}
                y={(first.y + last.y) / 2 - 6}
                fontSize={13}
                fill="#3c4053"
                paintOrder="stroke"
                stroke="#fff"
                strokeWidth={4}
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {kind === "flowchart" ? data.nodes.map((n) => <StepNode key={n.id} node={n} selected={n.id === selectedNodeId} />) : null}
      {children}
    </svg>
  );
}

/** Легенда потоков: цветная линия с нужным штрихом и подпись. */
export function FlowLegend({
  title,
  labels,
  kinds = FLOW_KINDS,
  className,
}: {
  title: string;
  labels: Record<FlowKind, string>;
  kinds?: FlowKind[];
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">{title}</div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-center gap-2 text-[13px] text-[#3c4053]">
            <svg width="34" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="33"
                y2="4"
                stroke={FLOW_STYLES[kind].color}
                strokeWidth="3"
                strokeDasharray={FLOW_STYLES[kind].dash ?? undefined}
                strokeLinecap="round"
              />
            </svg>
            {labels[kind]}
          </li>
        ))}
      </ul>
    </div>
  );
}
