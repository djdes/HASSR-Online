/** Дезинфекция, хранение, посуда и мелкие значки. Правила рисования — `types.ts`. */

import type { CSSProperties, ReactNode } from "react";

import { MISC_ART_NAMES, type MiscArtName, type PosterArtComponent, type PosterArtProps } from "./types";

const ROUND = { strokeLinecap: "round", strokeLinejoin: "round" } as const;
const TEXT = "var(--pb-text)";
const ACCENT = "var(--pb-secondary-ink)";
const BG = "var(--pb-bg)";

/** Контур тёмным, заливка на выбор. */
const line = (fill = "#fff", width = 2.75): CSSProperties => ({ fill, stroke: TEXT, strokeWidth: width, ...ROUND });
/** Только линия, без заливки. */
const ink = (width = 2.75): CSSProperties => ({ fill: "none", stroke: TEXT, strokeWidth: width, ...ROUND });
/** Акцентная линия. */
const acc = (width = 2.75): CSSProperties => ({ fill: "none", stroke: ACCENT, strokeWidth: width, ...ROUND });
/** Акцентная заливка. */
const accFill: CSSProperties = { fill: ACCENT, stroke: "none" };

/** Группа фигур с общим внешним контуром: внутренние линии пересечений скрыты. */
function Solid({ children, fill = "#fff", width = 2.75 }: { children: ReactNode; fill?: string; width?: number }) {
  return (
    <>
      <g style={{ fill: "none", stroke: TEXT, strokeWidth: width * 2, ...ROUND }}>{children}</g>
      <g style={{ fill, stroke: "none" }}>{children}</g>
    </>
  );
}

/** Труба: тёмная обводка вокруг белой линии. */
function Tube({ d, width = 9 }: { d: string; width?: number }) {
  return (
    <>
      <path d={d} style={{ fill: "none", stroke: TEXT, strokeWidth: width + 5.5, ...ROUND }} />
      <path d={d} style={{ fill: "none", stroke: "#fff", strokeWidth: width, ...ROUND }} />
    </>
  );
}

function Drop({ x, y, s = 1, filled = true }: { x: number; y: number; s?: number; filled?: boolean }) {
  return (
    <path
      d="M0 -9 Q-7 0 -7 3 a7 7 0 0 0 14 0 Q7 0 0 -9 Z"
      transform={`translate(${x} ${y}) scale(${s})`}
      style={filled ? accFill : { ...acc(2.75 / s), fill: "#fff" }}
    />
  );
}

function Sparkle({ x, y, s = 5 }: { x: number; y: number; s?: number }) {
  return (
    <path
      d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`}
      style={accFill}
    />
  );
}

function Tick({ cx, cy, r = 8 }: { cx: number; cy: number; r?: number }) {
  const k = r / 8;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} style={{ fill: "#fff", stroke: ACCENT, strokeWidth: 2.75, ...ROUND }} />
      <path
        d={`M${cx - 4 * k} ${cy + 0.5 * k} L${cx - 1 * k} ${cy + 3.5 * k} L${cx + 4.5 * k} ${cy - 3 * k}`}
        style={acc(2.75)}
      />
    </>
  );
}

function Scene({ label, title, className, children }: PosterArtProps & { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label={title ?? label} className={className}>
      <rect x="6" y="6" width="148" height="108" rx="30" style={{ fill: BG, stroke: "none" }} />
      {children}
    </svg>
  );
}

function Icon({ label, title, className, children }: PosterArtProps & { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label={title ?? label} className={className}>
      <g style={{ fill: "none", stroke: ACCENT, strokeWidth: 10, ...ROUND }}>{children}</g>
    </svg>
  );
}

function make(label: string, draw: () => ReactNode, kind: "scene" | "icon" = "scene"): PosterArtComponent {
  const Wrapper = kind === "scene" ? Scene : Icon;
  function Art({ className, title }: PosterArtProps) {
    return (
      <Wrapper label={label} className={className} title={title}>
        {draw()}
      </Wrapper>
    );
  }
  Art.displayName = `PosterArt(${label})`;
  return Art;
}

/* ───────────── Дезинфекция ───────────── */

const gloves = () => (
  <>
    <Solid>
      <rect x="56" y="30" width="9" height="32" rx="4.5" />
      <rect x="68" y="22" width="9" height="40" rx="4.5" />
      <rect x="80" y="26" width="9" height="36" rx="4.5" />
      <rect x="92" y="34" width="9" height="28" rx="4.5" />
      <rect x="56" y="50" width="45" height="42" rx="10" />
      <rect x="47" y="58" width="12" height="30" rx="6" transform="rotate(-28 56 86)" />
    </Solid>
    <Solid>
      <rect x="59" y="90" width="39" height="15" rx="4" />
    </Solid>
    <path d="M59 97.5 H98" style={acc(2.75)} />
    <path d="M70 60 Q78 67 86 60" style={ink(2.2)} />
    <Sparkle x={116} y={36} s={6} />
    <Sparkle x={28} y={40} s={4} />
    <Drop x={120} y={70} s={0.8} />
  </>
);

const closedContainer = () => (
  <>
    <Solid>
      <path d="M44 56 L52 100 Q53 105 58 105 H102 Q107 105 108 100 L116 56 Z" />
    </Solid>
    <Solid>
      <rect x="38" y="44" width="84" height="15" rx="7" />
      <rect x="66" y="34" width="28" height="10" rx="5" />
    </Solid>
    <path d="M44 51.5 H116" style={acc(2.75)} />
    <rect x="58" y="68" width="44" height="26" rx="7" style={{ ...acc(2.75), fill: BG }} />
    <Drop x={80} y={83} s={0.95} />
    <path d="M26 30 L32 38 M134 30 L128 38 M23 46 H31 M137 46 H129" style={acc(2.75)} />
  </>
);

const ventilation = () => (
  <>
    <rect x="52" y="22" width="60" height="80" rx="6" style={line("#fff")} />
    <rect x="59" y="29" width="46" height="66" rx="3" style={line(BG, 2.4)} />
    <path d="M59 62 H105" style={ink(2.4)} />
    <path d="M105 29 L130 38 V86 L105 95 Z" style={line("#fff")} />
    <path d="M114 50 L121 53 M114 62 L121 65" style={acc(2.4)} />
    <path d="M14 44 H36 Q43 44 43 38 Q43 32 37 32" style={acc(2.75)} />
    <path d="M14 62 H46 M39 55 L46 62 L39 69" style={acc(2.75)} />
    <path d="M14 80 H34 Q41 80 41 86 Q41 92 35 92" style={acc(2.75)} />
  </>
);

const respirator = () => (
  <>
    <path d="M30 40 H40 M120 40 H130" style={ink(2.75)} />
    <path d="M35 40 Q35 36 40 36" style={ink(2.75)} />
    <rect x="42" y="26" width="34" height="26" rx="13" style={line("#fff")} />
    <rect x="84" y="26" width="34" height="26" rx="13" style={line("#fff")} />
    <path d="M76 38 Q80 33 84 38" style={ink(2.75)} />
    <path d="M50 34 Q54 31 58 32 M92 34 Q96 31 100 32" style={acc(2.4)} />
    <path d="M52 68 L36 60 M108 68 L124 60" style={ink(2.75)} />
    <path d="M52 68 Q80 58 108 68 Q112 90 94 100 Q80 107 66 100 Q48 90 52 68 Z" style={line("#fff")} />
    <circle cx="62" cy="86" r="8" style={{ ...acc(2.75), fill: BG }} />
    <circle cx="98" cy="86" r="8" style={{ ...acc(2.75), fill: BG }} />
    <circle cx="80" cy="82" r="3.5" style={ink(2.4)} />
  </>
);

const washFace = () => (
  <>
    <Tube d="M146 24 H122 Q112 24 112 34 V44" width={8} />
    <path d="M112 54 V66 M105 58 V64 M119 58 V64" style={acc(2.75)} />
    <Solid fill="#fff">
      <path d="M92 80 H134 Q134 102 113 102 Q92 102 92 80 Z" />
    </Solid>
    <path d="M95 80 Q104 76 113 80 Q122 84 131 80" style={acc(2.75)} />
    <circle cx="54" cy="64" r="28" style={line("#fff")} />
    <path d="M28 56 Q30 34 54 34 Q78 34 80 56 Q66 50 54 44 Q42 52 28 56 Z" style={line(BG)} />
    <path d="M43 62 Q47 66 51 62 M58 62 Q62 66 66 62" style={ink(2.5)} />
    <path d="M46 76 Q55 83 64 76" style={ink(2.5)} />
    <Drop x={22} y={36} s={0.85} />
    <Drop x={84} y={36} s={0.85} />
    <Drop x={86} y={84} s={0.65} />
  </>
);

/* ───────────── Кухня и хранение ───────────── */

const eggs = () => (
  <>
    <ellipse cx="60" cy="48" rx="13" ry="17" transform="rotate(-14 60 48)" style={line("#fff")} />
    <ellipse cx="82" cy="42" rx="13" ry="17" transform="rotate(6 82 42)" style={line("#fff")} />
    <ellipse cx="102" cy="50" rx="13" ry="17" transform="rotate(20 102 50)" style={line("#fff")} />
    <path d="M54 40 Q55 34 60 32 M76 34 Q77 29 82 28" style={acc(2.4)} />
    <path d="M36 64 H124 Q124 106 80 106 Q36 106 36 64 Z" style={line("#fff")} />
    <path d="M36 64 H124" style={ink(3)} />
    <circle cx="58" cy="80" r="2.6" style={accFill} />
    <circle cx="80" cy="86" r="2.6" style={accFill} />
    <circle cx="102" cy="80" r="2.6" style={accFill} />
    <circle cx="69" cy="95" r="2.6" style={accFill} />
    <circle cx="91" cy="95" r="2.6" style={accFill} />
    <path d="M36 70 Q22 70 22 80 M124 70 Q138 70 138 80" style={ink(2.75)} />
    <Drop x={26} y={44} s={0.85} />
    <Drop x={136} y={50} s={0.85} />
    <Sparkle x={134} y={28} s={5} />
  </>
);

const dishes = () => (
  <>
    <ellipse cx="62" cy="90" rx="34" ry="9" style={line("#fff")} />
    <ellipse cx="62" cy="79" rx="34" ry="9" style={line("#fff")} />
    <ellipse cx="62" cy="68" rx="34" ry="9" style={line("#fff")} />
    <ellipse cx="62" cy="67" rx="20" ry="4.5" style={acc(2.4)} />
    <Solid>
      <rect x="107" y="46" width="26" height="32" rx="7" />
      <rect x="114" y="36" width="12" height="11" rx="3" />
    </Solid>
    <path d="M126 39 H134" style={ink(2.75)} />
    <Drop x={120} y={62} s={0.9} />
    <Solid fill={BG}>
      <rect x="100" y="86" width="38" height="17" rx="6" />
    </Solid>
    <path d="M100 94 H138" style={acc(2.4)} />
    <circle cx="112" cy="99" r="1.8" style={accFill} />
    <circle cx="124" cy="99" r="1.8" style={accFill} />
    <circle cx="42" cy="42" r="6" style={acc(2.4)} />
    <circle cx="58" cy="32" r="4" style={acc(2.4)} />
    <circle cx="76" cy="44" r="5" style={acc(2.4)} />
    <Sparkle x={88} y={30} s={4} />
  </>
);

const storage = () => (
  <>
    <rect x="30" y="14" width="96" height="92" rx="10" style={line("#fff")} />
    <path d="M30 58 H126" style={ink(2.75)} />
    <path d="M30 98 H126" style={ink(2.4)} />
    <path d="M52 58 A20 20 0 0 1 92 58 Z" style={line(BG)} />
    <circle cx="72" cy="35" r="3.2" style={line("#fff", 2.4)} />
    <rect x="102" y="40" width="14" height="18" rx="3" style={line(BG, 2.4)} />
    <path d="M102 46 H116" style={acc(2.4)} />
    <Tick cx={44} cy={28} r={8} />
    <path d="M44 88 Q40 74 56 70 Q74 62 88 72 Q96 84 82 92 Q64 98 44 88 Z" style={line(BG)} />
    <circle cx="68" cy="81" r="5" style={acc(2.4)} />
    <path d="M100 76 L116 76 M100 88 L116 88" style={ink(2.4)} />
    <path d="M142 30 V90 M135 82 L142 90 L149 82" style={acc(3)} />
  </>
);

const hygiene = () => (
  <>
    <rect x="74" y="62" width="12" height="16" rx="4" style={line("#fff")} />
    <Solid>
      <circle cx="67" cy="28" r="9" />
      <circle cx="80" cy="21" r="10.5" />
      <circle cx="93" cy="28" r="9" />
      <rect x="66" y="30" width="28" height="12" rx="3" />
    </Solid>
    <path d="M66 36 H94" style={acc(2.4)} />
    <circle cx="80" cy="54" r="14" style={line("#fff")} />
    <path d="M70 46 Q80 40 90 46" style={ink(2.4)} />
    <circle cx="75" cy="54" r="1.6" style={{ fill: TEXT, stroke: "none" }} />
    <circle cx="85" cy="54" r="1.6" style={{ fill: TEXT, stroke: "none" }} />
    <path d="M75 60 Q80 64 85 60" style={ink(2.2)} />
    <path d="M50 108 Q50 80 80 74 Q110 80 110 108 Z" style={line("#fff")} />
    <path d="M69 77 L80 92 L91 77" style={acc(2.75)} />
    <path d="M80 92 V108" style={ink(2.4)} />
    <circle cx="73" cy="98" r="2" style={accFill} />
    <circle cx="87" cy="98" r="2" style={accFill} />
    <Drop x={28} y={62} s={1} />
    <Sparkle x={26} y={38} s={5} />
    <Tick cx={132} cy={60} r={9} />
    <Sparkle x={132} y={36} s={4} />
  </>
);

/* ───────────── Значки ───────────── */

const iconCheck = () => (
  <>
    <circle cx="80" cy="60" r="42" />
    <path d="M60 61 L75 76 L102 46" />
  </>
);

const iconCross = () => (
  <>
    <circle cx="80" cy="60" r="42" />
    <path d="M65 45 L95 75 M95 45 L65 75" />
  </>
);

const iconWarning = () => (
  <>
    <path d="M80 16 L124 94 H36 Z" />
    <path d="M80 44 V68" />
    <circle cx="80" cy="81" r="1.5" />
  </>
);

const iconClock = () => (
  <>
    <circle cx="80" cy="60" r="42" />
    <path d="M80 60 V34 M80 60 L98 72" />
  </>
);

const iconThermometer = () => (
  <>
    <path d="M70 66 V28 a10 10 0 0 1 20 0 V66 a22 22 0 1 1 -20 0 Z" />
    <path d="M80 44 V84" />
    <circle cx="80" cy="86" r="6" style={{ fill: ACCENT }} />
    <path d="M104 30 H116 M104 46 H112 M104 62 H116" />
  </>
);

const iconSnowflake = () => (
  <g style={{ strokeWidth: 8 }}>
    {[0, 60, 120].map((a) => (
      <g key={a} transform={`rotate(${a} 80 60)`}>
        <path d="M80 16 V104" />
        <path d="M69 26 L80 37 L91 26" />
        <path d="M69 94 L80 83 L91 94" />
      </g>
    ))}
  </g>
);

const iconLabel = () => (
  <>
    <path d="M58 24 H118 Q126 24 126 32 V88 Q126 96 118 96 H58 L28 60 Z" />
    <circle cx="54" cy="60" r="1.5" />
    <path d="M76 46 H108 M76 62 H108 M76 78 H96" />
  </>
);

const ART: Record<MiscArtName, PosterArtComponent> = {
  "dz-gloves": make("Резиновая перчатка", gloves),
  "dz-closed-container": make("Ёмкость с плотно закрытой крышкой", closedContainer),
  "dz-ventilation": make("Открытое окно, проветривание", ventilation),
  "dz-respirator": make("Респиратор и защитные очки", respirator),
  "dz-wash-face": make("Умывание лица и рук", washFace),
  eggs: make("Яйца в дуршлаге под водой", eggs),
  dishes: make("Стопка тарелок, губка и моющее средство", dishes),
  storage: make("Полки холодильника: готовое сверху, сырое снизу", storage),
  hygiene: make("Повар в колпаке и кителе", hygiene),
  "icon-check": make("Галочка", iconCheck, "icon"),
  "icon-cross": make("Крестик", iconCross, "icon"),
  "icon-warning": make("Внимание", iconWarning, "icon"),
  "icon-clock": make("Часы", iconClock, "icon"),
  "icon-thermometer": make("Термометр", iconThermometer, "icon"),
  "icon-snowflake": make("Снежинка, холод", iconSnowflake, "icon"),
  "icon-label": make("Этикетка", iconLabel, "icon"),
};

export const MISC_ART: Record<MiscArtName, PosterArtComponent> = Object.fromEntries(
  MISC_ART_NAMES.map((name) => [name, ART[name]]),
) as Record<MiscArtName, PosterArtComponent>;
