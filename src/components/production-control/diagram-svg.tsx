import type { ReactNode, Ref, SVGProps } from "react";
import { FLOW_KINDS, FLOW_STYLES, doorSwingVector, edgeAnchors } from "@/lib/ppk/diagram";
import type { DiagramData, DiagramDoor, DiagramEdge, DiagramNode, DoorKind, FlowKind } from "@/lib/ppk/records";

/*
 * Отрисовка схемы чистым SVG без интерактива: ею пользуются редактор (поверх
 * неё рисуются выделение и черновики), мини-превью карточек и печатные листы.
 */

const STEP_STROKE = "#dcdfed";
const ROOM_STROKE = "#3c4053";
const ARROW_COLOR = "#6f7282";
const DOOR_STROKE = "#3c4053";

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
 * Значок двери в своих координатах: проём вдоль оси X от −w/2 до w/2 на y = 0,
 * петли — у левого края, полотно открывается вверх (−y). Поворот и зеркало —
 * `transform` группы. Проём (без двери) — только разрыв стены и откосы.
 */
function DoorGlyph({ kind, w, stroke = DOOR_STROKE }: { kind: DoorKind; w: number; stroke?: string }) {
  const half = w / 2;
  return (
    <>
      {/* Разрыв стены: белая полоса поверх линии стены (стена 2.5px). */}
      <rect x={-half} y={-4.5} width={w} height={9} fill="#fff" />
      <line x1={-half} y1={-6} x2={-half} y2={6} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" />
      <line x1={half} y1={-6} x2={half} y2={6} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" />
      {kind === "door" ? (
        <>
          <line x1={-half} y1={0} x2={-half} y2={-w} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
          <path d={`M ${-half} ${-w} A ${w} ${w} 0 0 1 ${half} 0`} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="4 3" />
        </>
      ) : (
        <line x1={-half} y1={0} x2={half} y2={0} stroke={stroke} strokeWidth={1} strokeDasharray="3 3" />
      )}
    </>
  );
}

function DoorNode({ door, selected }: { door: DiagramDoor; selected: boolean }) {
  const transform = `translate(${door.x} ${door.y}) rotate(${door.angle})${door.flip ? " scale(-1 1)" : ""}`;
  const half = door.w / 2;
  const depth = door.kind === "door" ? door.w : 0;
  // Подпись — с другой стороны от полотна, всегда горизонтально.
  const swing = doorSwingVector(door.angle);
  const labelGap = 16;
  return (
    <g data-door={door.id}>
      <g transform={transform}>
        {/* Зона нажатия: проём и полотно с запасом. */}
        <rect x={-half - 6} y={-depth - 6} width={door.w + 12} height={depth + 12} fill="transparent" />
        {selected ? (
          <rect x={-half - 6} y={-depth - 6} width={door.w + 12} height={depth + 12} rx={6} fill="#5566f6" fillOpacity={0.08} stroke="#5566f6" strokeWidth={2} />
        ) : null}
        <DoorGlyph kind={door.kind} w={door.w} stroke={selected ? "#5566f6" : DOOR_STROKE} />
      </g>
      {door.label ? (
        <text
          x={door.x - swing.x * labelGap}
          y={door.y - swing.y * labelGap}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
          fill="#3c4053"
          paintOrder="stroke"
          stroke="#fff"
          strokeWidth={4}
        >
          {door.label}
        </text>
      ) : null}
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
  selectedDoorId,
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
  selectedDoorId?: string | null;
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
      {/* Двери — поверх стен помещений, под линиями потоков. */}
      {kind === "floor-plan"
        ? (data.doors ?? []).map((d) => <DoorNode key={d.id} door={d} selected={d.id === selectedDoorId} />)
        : null}

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

/** Значок двери или проёма для легенды и кнопок: стена с разрывом. */
export function DoorIcon({ kind, className }: { kind: DoorKind; className?: string }) {
  return (
    <svg width="34" height="22" viewBox="-17 -20 34 24" aria-hidden="true" className={className}>
      <line x1={-17} y1={0} x2={-10} y2={0} stroke={ROOM_STROKE} strokeWidth={2.5} />
      <line x1={10} y1={0} x2={17} y2={0} stroke={ROOM_STROKE} strokeWidth={2.5} />
      <g transform="scale(0.85)">
        <DoorGlyph kind={kind} w={20} />
      </g>
    </svg>
  );
}

/** Легенда потоков: цветная линия с нужным штрихом и подпись; ниже — двери и проёмы, если есть. */
export function FlowLegend({
  title,
  labels,
  kinds = FLOW_KINDS,
  doorKinds = [],
  doorLabels,
  className,
}: {
  title: string;
  labels: Record<FlowKind, string>;
  kinds?: FlowKind[];
  doorKinds?: DoorKind[];
  doorLabels?: Record<DoorKind, string>;
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
        {doorLabels
          ? doorKinds.map((kind) => (
              <li key={`door-${kind}`} className="flex items-center gap-2 text-[13px] text-[#3c4053]">
                <DoorIcon kind={kind} />
                {doorLabels[kind]}
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
