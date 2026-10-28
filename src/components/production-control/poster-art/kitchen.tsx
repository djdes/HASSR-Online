/** Одежда повара, перекрёстные загрязнения, суточная проба, осмотр. Правила рисования — `types.ts`. */

import type { CSSProperties, ReactNode } from "react";

import { KITCHEN_ART_NAMES, type KitchenArtName, type PosterArtComponent, type PosterArtProps } from "./types";

const T = "var(--pb-text)";
const ACC = "var(--pb-secondary-ink)";
const BG = "var(--pb-bg)";
const W = "#fff";

/** Контур цвета текста, заливка — `fill`. */
const o = (fill: string = "none", w = 2.8): CSSProperties => ({
  fill,
  stroke: T,
  strokeWidth: w,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});
/** Контур акцентного цвета. */
const a = (fill: string = "none", w = 2.8): CSSProperties => ({
  fill,
  stroke: ACC,
  strokeWidth: w,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});
/** Заливка без контура. */
const f = (fill: string): CSSProperties => ({ fill, stroke: "none" });
const label = (size: number, anchor: "start" | "middle" | "end" = "middle"): CSSProperties => ({
  fill: T,
  fontSize: size,
  fontWeight: 700,
  textAnchor: anchor,
});

function Frame({
  className,
  title,
  fallback,
  children,
}: PosterArtProps & { fallback: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label={title ?? fallback} className={className}>
      <rect x="3" y="3" width="154" height="114" rx="20" style={f(BG)} />
      {children}
    </svg>
  );
}

/** Круглый значок ✓ / ✗ — смысл передаёт форма, а не цвет. */
function Badge({ cx, cy, r = 11, kind }: { cx: number; cy: number; r?: number; kind: "ok" | "no" }) {
  const k = r / 11;
  return (
    <g transform={`translate(${cx} ${cy}) scale(${k})`}>
      <circle r="11" style={{ fill: ACC, stroke: W, strokeWidth: 2.5 / k }} />
      <path
        d={kind === "ok" ? "M-5 0.5 L-1.6 4 L5.5 -4" : "M-4.5 -4.5 L4.5 4.5 M4.5 -4.5 L-4.5 4.5"}
        style={{ fill: "none", stroke: W, strokeWidth: 3.4, strokeLinecap: "round", strokeLinejoin: "round" }}
      />
    </g>
  );
}

/* ------------------------------------------------------------------ повар */

function Chef({ wrong, className, title }: PosterArtProps & { wrong: boolean }) {
  const mirror = "translate(160 0) scale(-1 1)";
  const arm = (
    <>
      <path d="M65 47 Q57 48 56 56 L53 78 L63 80 L67 62" style={o(W)} />
      <circle cx="58" cy="85.5" r="5.5" style={o(BG)} />
    </>
  );
  return (
    <Frame
      className={className}
      title={title}
      fallback={wrong ? "Повар одет неправильно" : "Повар одет правильно"}
    >
      {/* брюки */}
      <path
        d="M66 80 H94 L92 108 H81 L80 92 L79 108 H68 Z"
        style={o(BG)}
      />
      {wrong ? (
        <>
          <path d="M67.5 84 V104 M92.5 84 V104" style={{ ...o(), strokeWidth: 1.8, strokeDasharray: "2.5 3.5" }} />
          <path d="M68.5 102.5 H79 M81 102.5 H91.5" style={{ ...o(), strokeWidth: 1.8 }} />
        </>
      ) : (
        <path d="M73.5 100 V105 M86.5 100 V105" style={{ ...o(), strokeWidth: 1.8 }} />
      )}

      {/* обувь */}
      {wrong ? (
        <>
          <g>
            <path d="M69 108 V112 H78 V108" style={o(BG, 2.4)} />
            <rect x="63" y="112" width="17" height="4.5" rx="2.2" style={o(ACC, 2.4)} />
            <path d="M70 112 L73.5 108.5 L77 112" style={a("none", 2.2)} />
          </g>
          <g transform={mirror}>
            <path d="M69 108 V112 H78 V108" style={o(BG, 2.4)} />
            <rect x="63" y="112" width="17" height="4.5" rx="2.2" style={o(ACC, 2.4)} />
            <path d="M70 112 L73.5 108.5 L77 112" style={a("none", 2.2)} />
          </g>
        </>
      ) : (
        <>
          <path d="M67 107 H79 V112 Q79 116 75 116 H65 Q62 116 62 113 Q62 109 67 107 Z" style={o(T)} />
          <g transform={mirror}>
            <path d="M67 107 H79 V112 Q79 116 75 116 H65 Q62 116 62 113 Q62 109 67 107 Z" style={o(T)} />
          </g>
        </>
      )}

      {/* шея — под воротником и головой: с заливкой кожи, а не двумя тёмными линиями (они печатались как борода) */}
      <path d="M76.5 37 V50 H83.5 V37" style={o(BG, 2)} />

      {/* китель */}
      <path d="M65 46 Q80 52 95 46 L96 82 H64 Z" style={o(W)} />
      <g>{arm}</g>
      <g transform={mirror}>{arm}</g>
      <path d="M72 46 L80 58 L88 46" style={a("none", 3)} />
      <path d="M80 58 V76" style={{ ...o(), strokeWidth: 1.6 }} />
      <circle cx="80" cy="64" r="1.8" style={f(T)} />
      <circle cx="80" cy="71" r="1.8" style={f(T)} />

      {/* фартук */}
      <path d="M67 76 H93 L95 100 H65 Z" style={o(W)} />
      <path d="M67 79 H93" style={a("none", 2.2)} />
      <rect x="72" y="88" width="16" height="8" rx="2" style={{ ...o(), strokeWidth: 1.8 }} />

      {/*
        Голова — приветливое лицо: брови, глаза, улыбка. У «неправильно» — без
        колпака, светлые волосы с косым пробором: прядь вдоль одной щеки, с
        другой стороны короче (2026-10-28: тёмные длинные волосы вокруг лица и
        тёмная шея читались как капюшон с бородой, пушистые вокруг всего лица —
        как меховой капюшон). Волосы не смыкаются под подбородком.
      */}
      <ellipse cx="80" cy="32" rx="8.5" ry="9.5" style={o(BG)} />
      <path d="M74.6 29.4 Q76.5 28.2 78.4 29.4 M81.6 29.4 Q83.5 28.2 85.4 29.4" style={{ ...o(), strokeWidth: 1.4 }} />
      <circle cx="76.5" cy="32.6" r="1.4" style={f(T)} />
      <circle cx="83.5" cy="32.6" r="1.4" style={f(T)} />
      <path d="M76.8 36.8 Q80 39.6 83.2 36.8" style={{ ...o(), strokeWidth: 1.9 }} />

      {wrong ? (
        <>
          {/* волосы: шапка с косой чёлкой, длинная прядь слева, справа до уха */}
          <path
            d="M70.4 38.6 Q68.4 33 69.2 27.5 Q70.4 19.4 79.6 18.8 Q89.4 18.6 90.6 27.2 Q91 31 89.4 33.8 Q88.2 30.6 88.6 28.4 Q85 25.4 79.6 25.6 Q74.6 26.4 72.6 31 Q72 34.6 72.8 37.6 Q71.8 39.4 70.4 38.6 Z"
            style={o(W, 2)}
          />
          <path d="M84.6 20.4 Q80 21.8 75.6 25.2" style={{ ...o(), strokeWidth: 1.3 }} />
          {/* ручка в кармане */}
          <rect x="84" y="59" width="9" height="8" rx="2" style={{ ...o(), strokeWidth: 1.8 }} />
          <path d="M89 52 V63" style={a("none", 3)} />
          {/* пятна */}
          <path d="M70 65 Q73 61 76 65 Q75 70 71 70 Q68 69 70 65 Z" style={{ ...f(ACC) }} />
          <path d="M84 76 Q88 72 91 76 Q91 81 86 82 Q82 80 84 76 Z" style={{ ...f(ACC) }} />
          <circle cx="76" cy="94" r="2.6" style={f(ACC)} />
          {/* часы и кольцо */}
          <rect x="51.5" y="75.5" width="13" height="6" rx="2.4" style={o(W, 2.2)} />
          <circle cx="58" cy="78.5" r="1.4" style={f(T)} />
          <ellipse cx="102" cy="87.5" rx="4.6" ry="2.2" style={a("none", 2.2)} />
        </>
      ) : (
        <>
          <path d="M69 25 V20 Q62 19 63 12 Q64 6 72 8 Q80 2 88 8 Q96 6 97 12 Q98 19 91 20 V25 Z" style={o(W)} />
          <path d="M76 12.5 V20 M84 12.5 V20" style={{ ...o(), strokeWidth: 1.8 }} />
          <rect x="84" y="59" width="9" height="8" rx="2" style={{ ...o(), strokeWidth: 1.8 }} />
        </>
      )}

      <Badge cx={135} cy={20} kind={wrong ? "no" : "ok"} />
    </Frame>
  );
}

const ChefCorrect = (p: PosterArtProps) => <Chef {...p} wrong={false} />;
const ChefWrong = (p: PosterArtProps) => <Chef {...p} wrong />;

/* -------------------------------------------------- перекрёстные загрязнения */

function CcRawReady({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Сырьё и готовая продукция разделены">
      {/* сырое: рыба */}
      <path d="M62 40 L74 30 V50 Z" style={o(W)} />
      <path d="M16 40 Q38 20 62 40 Q38 60 16 40 Z" style={o(W)} />
      <circle cx="27" cy="37" r="2" style={f(T)} />
      <path d="M40 30 Q45 40 40 50" style={{ ...o(), strokeWidth: 2 }} />
      {/* сырое: окорочок */}
      <path d="M22 90 Q20 72 40 72 Q58 74 52 90 Q46 101 33 99 Q24 97 22 90 Z" style={o(W)} />
      <path d="M50 90 L62 101" style={o()} />
      <circle cx="63" cy="97" r="3.2" style={o(W, 2.4)} />
      <circle cx="66" cy="104" r="3.2" style={o(W, 2.4)} />
      <path d="M30 82 Q36 78 42 82" style={{ ...a(), strokeWidth: 2 }} />
      {/* разделитель */}
      <path d="M80 12 V108" style={{ ...a("none", 3.6), strokeDasharray: "9 7" }} />
      {/* готовое: тарелка с котлетами */}
      <ellipse cx="120" cy="82" rx="30" ry="11" style={o(W)} />
      <ellipse cx="120" cy="80" rx="20" ry="6.5" style={{ ...o(), strokeWidth: 1.8 }} />
      <ellipse cx="109" cy="72" rx="9" ry="6" style={o(BG)} />
      <ellipse cx="124" cy="68" rx="9" ry="6" style={o(BG)} />
      <ellipse cx="133" cy="76" rx="8" ry="5.5" style={o(BG)} />
      <path d="M109 40 Q105 46 109 52 M122 36 Q118 42 122 48 M135 40 Q131 46 135 52" style={a()} />
    </Frame>
  );
}

function CcBoards({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Две разделочные доски с разными метками: СМ и ВМ">
      <g transform="rotate(-4 38 62)">
        <rect x="10" y="16" width="56" height="92" rx="10" style={o(W)} />
        <rect x="10" y="16" width="56" height="16" rx="10" style={o(ACC)} />
        <rect x="10" y="26" width="56" height="6" style={f(ACC)} />
        <ellipse cx="38" cy="24" rx="6" ry="3.4" style={o(W, 2.2)} />
        <text x="38" y="78" style={label(26)}>СМ</text>
      </g>
      <g transform="rotate(4 122 62)">
        <rect x="94" y="16" width="56" height="92" rx="10" style={o(W)} />
        <rect x="94" y="16" width="56" height="16" rx="10" style={o(BG)} />
        <rect x="94" y="26" width="56" height="6" style={f(BG)} />
        <path d="M94 32 H150" style={o()} />
        <ellipse cx="122" cy="24" rx="6" ry="3.4" style={o(W, 2.2)} />
        <text x="122" y="78" style={label(26)}>ВМ</text>
      </g>
      <path d="M72 54 H88 M72 68 H88 M71 74 L89 48" style={a("none", 3.4)} />
    </Frame>
  );
}

function CcDamaged({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Тарелка со сколом и треснувшая кастрюля">
      {/* тарелка со сколом */}
      <path d="M58 37.8 L60.5 47 L66.9 45.9 A28 28 0 1 1 58 37.8 Z" style={o(W)} />
      <circle cx="44" cy="62" r="17" style={{ ...o(), strokeWidth: 2 }} />
      <path d="M26 74 L33 69 L31 63" style={a("none", 2.4)} />
      {/* треснувшая кастрюля */}
      <path d="M90 52 H138 V92 Q138 100 130 100 H98 Q90 100 90 92 Z" style={o(W)} />
      <path d="M86 50 H142" style={o()} />
      <path d="M90 60 H80 Q77 60 77 63 V66 M138 60 H148 Q151 60 151 63 V66" style={o()} />
      <path d="M118 51 L112 63 L122 71 L114 82 L119 90" style={a("none", 2.6)} />
      {/* ✗ */}
      <Badge cx={66} cy={92} r={11} kind="no" />
      <Badge cx={138} cy={30} r={11} kind="no" />
    </Frame>
  );
}

function CcSanitize({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Инвентарь под струями воды с пеной">
      {/* кран */}
      <path d="M52 12 H76 Q86 12 86 22 V27" style={o()} />
      <rect x="78" y="27" width="16" height="6" rx="2" style={o(W, 2.4)} />
      <path d="M81 38 V44 M86 38 V48 M91 38 V44" style={a()} />
      {/* доска */}
      <rect x="12" y="56" width="38" height="50" rx="7" style={o(W)} />
      <ellipse cx="31" cy="64" rx="4.5" ry="2.6" style={o(W, 2.2)} />
      {/* нож */}
      <path d="M68 52 Q88 56 88 88 H68 Z" style={o(W)} />
      <rect x="71" y="88" width="11" height="18" rx="3.5" style={o(BG)} />
      {/* половник */}
      <path d="M110 88 A15 15 0 0 0 140 88 Z" style={o(W)} />
      <path d="M139 90 L148 58 Q149 53 144 53" style={o()} />
      {/* пена */}
      <circle cx="22" cy="74" r="5" style={a(W, 2.4)} />
      <circle cx="40" cy="86" r="3.6" style={a(W, 2.4)} />
      <circle cx="30" cy="96" r="3" style={a(W, 2.2)} />
      <circle cx="94" cy="66" r="3.4" style={a(W, 2.4)} />
      <circle cx="64" cy="78" r="3.2" style={a(W, 2.2)} />
      <circle cx="125" cy="76" r="4.2" style={a(W, 2.4)} />
      <circle cx="108" cy="102" r="3" style={a(W, 2.2)} />
      <circle cx="132" cy="106" r="3.2" style={a(W, 2.2)} />
    </Frame>
  );
}

/* ----------------------------------------------------------- суточная проба */

function DsJar({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Стеклянная баночка с крышкой и этикеткой «проба»">
      <path d="M62 34 H98 V38 Q105 44 105 54 V98 Q105 109 94 109 H66 Q55 109 55 98 V54 Q55 44 62 38 Z" style={o(W)} />
      <rect x="57" y="18" width="46" height="16" rx="5" style={o(ACC)} />
      <path d="M67 18 V34 M77 18 V34 M87 18 V34 M97 18 V34" style={{ stroke: W, strokeWidth: 1.8, strokeLinecap: "round" }} />
      <path d="M56 52 Q80 58 104 52" style={{ ...o(), strokeWidth: 2 }} />
      <rect x="63" y="62" width="34" height="30" rx="4" style={o(BG, 2.4)} />
      <path d="M70 72 H90 M70 82 H82" style={{ ...o(), strokeWidth: 2.4 }} />
      <path d="M62 54 V98" style={{ stroke: ACC, strokeWidth: 2.4, strokeLinecap: "round", fill: "none", strokeDasharray: "10 6" }} />
      <path d="M122 30 V42 M116 36 H128 M32 52 V60 M28 56 H36" style={a()} />
    </Frame>
  );
}

function DsSpoon({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Стерильная ложка над котлом">
      {/* котёл */}
      <path d="M34 80 V100 Q34 110 44 110 H116 Q126 110 126 100 V80" style={o(W)} />
      <ellipse cx="80" cy="80" rx="46" ry="11" style={o(BG)} />
      <ellipse cx="80" cy="81" rx="37" ry="7" style={{ ...o(W), strokeWidth: 2 }} />
      <path d="M34 88 H26 Q23 88 23 91 V94 M126 88 H134 Q137 88 137 91 V94" style={o()} />
      {/* ложка */}
      <path d="M104 52 L134 14 L140 19 L110 58 Z" style={o(BG)} />
      <ellipse cx="98" cy="62" rx="11" ry="7.5" transform="rotate(-38 98 62)" style={o(W)} />
      <path d="M90 74 Q88 78 91 79 Q94 78 92 74" style={a()} />
      {/* стерильность */}
      <path d="M36 28 V40 M30 34 H42 M62 14 V22 M58 18 H66" style={a()} />
      <path d="M52 60 Q48 66 52 70 M70 56 Q66 62 70 66" style={{ ...a(), strokeWidth: 2.2 }} />
    </Frame>
  );
}

function DsFridge({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Холодильник: хранить пробу при +2…+6 °C 48 часов">
      <rect x="10" y="9" width="58" height="102" rx="8" style={o(BG)} />
      <rect x="16" y="15" width="46" height="90" rx="4" style={o(W)} />
      <path d="M16 42 H62 M16 68 H62 M16 92 H62" style={{ ...o(), strokeWidth: 2.2 }} />
      {/* баночка на средней полке */}
      <rect x="29" y="49" width="20" height="19" rx="3" style={o(BG, 2.4)} />
      <rect x="28" y="45" width="22" height="6" rx="2" style={o(ACC, 2.2)} />
      <path d="M20 22 L28 30 M28 22 L20 30 M24 20 V32 M18 26 H30" style={{ ...a(), strokeWidth: 2 }} />
      {/* шкала */}
      <text x="115" y="30" style={label(11.5)}>+2…+6 °C</text>
      <path d="M84 46 H146" style={o()} />
      <path d="M84 41 V51 M115 41 V51 M146 41 V51" style={{ ...o(), strokeWidth: 2.2 }} />
      <path d="M100 46 H128" style={a("none", 6)} />
      <path d="M114 62 L115 56 L116 62" style={a(ACC, 2)} />
      {/* время */}
      <circle cx="90" cy="88" r="11" style={o(W)} />
      <path d="M90 81 V88 L95 91" style={o()} />
      <text x="128" y="94" style={label(18)}>48 ч</text>
    </Frame>
  );
}

/** Проба не меньше 100 г: миска с блюдом на кухонных весах (скан 97). */
function DsWeight({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Миска с блюдом на весах: не менее 100 г">
      {/* пар */}
      <path d="M68 22 Q64 28 68 34 M80 18 Q76 24 80 30 M92 22 Q88 28 92 34" style={a()} />
      {/* миска */}
      <path d="M42 42 H118 Q117 68 92 70 H68 Q43 68 42 42 Z" style={o(W)} />
      <ellipse cx="80" cy="42" rx="38" ry="6" style={o(BG)} />
      {/* весы */}
      <rect x="30" y="70" width="100" height="8" rx="4" style={o(W)} />
      <path d="M38 78 L34 106 Q34 110 38 110 H122 Q126 110 126 106 L122 78" style={o(W)} />
      <rect x="52" y="85" width="56" height="18" rx="5" style={o(BG, 2.4)} />
      <text x="80" y="99" style={label(13)}>≥100 г</text>
    </Frame>
  );
}

/** Порционные блюда — поштучно, целиком: котлета и яблоко на тарелке, «1 шт». */
function DsPortion({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Целая котлета и целое яблоко на тарелке: одна порция">
      {/* тарелка */}
      <ellipse cx="72" cy="88" rx="52" ry="15" style={o(W)} />
      <ellipse cx="72" cy="86" rx="36" ry="9" style={{ ...o(), strokeWidth: 1.8 }} />
      {/* котлета */}
      <path d="M38 78 Q38 62 58 62 Q78 62 78 78 Q78 84 58 84 Q38 84 38 78 Z" style={o(BG)} />
      <path d="M48 70 L54 66 M56 74 L64 68 M64 77 L70 72" style={a("none", 2.4)} />
      {/* яблоко */}
      <path d="M98 50 Q90 46 86 54 Q82 64 88 74 Q92 81 98 78 Q104 81 108 74 Q114 64 110 54 Q106 46 98 50 Z" style={o(W)} />
      <path d="M98 50 Q98 44 101 40" style={o()} />
      <path d="M100 44 Q107 38 112 42 Q106 47 100 44 Z" style={a(ACC, 2)} />
      {/* одна штука */}
      <rect x="112" y="14" width="38" height="22" rx="11" style={f(ACC)} />
      <text x="131" y="29.5" style={{ ...label(12.5), fill: W }}>1 шт</text>
    </Frame>
  );
}

/* ------------------------------------------------------------------ осмотр */

function HeadProfile() {
  return (
    <>
      <path
        d="M50 28 Q56 8 80 10 Q100 12 102 36 L112 56 L102 62 L103 70 Q104 75 99 77 Q103 83 97 88 L94 96 L94 112 L64 112 L64 86 Q50 76 46 62 Q38 42 50 28 Z"
        style={o(W)}
      />
      <path d="M50 30 Q52 10 80 10 Q98 12 101 30 Q84 18 66 26 Q56 30 50 30 Z" style={o(T, 2)} />
      <ellipse cx="72" cy="52" rx="6" ry="9" style={o(BG, 2.4)} />
      <circle cx="91" cy="38" r="2.2" style={f(T)} />
      <path d="M86 30 Q91 28 96 31" style={{ ...o(), strokeWidth: 2.2 }} />
      <path d="M96 70 H102" style={{ ...o(), strokeWidth: 2.2 }} />
    </>
  );
}

function DiSkin({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Открытая кисть руки под лупой: осмотр кожи">
      <ellipse cx="14" cy="78" rx="5.5" ry="14" transform="rotate(-25 14 78)" style={o(BG)} />
      <rect x="18" y="34" width="11" height="44" rx="5.5" style={o(BG)} />
      <rect x="28.5" y="27" width="11" height="52" rx="5.5" style={o(BG)} />
      <rect x="39" y="25" width="11" height="54" rx="5.5" style={o(BG)} />
      <rect x="49.5" y="32" width="11" height="46" rx="5.5" style={o(BG)} />
      <path d="M18 70 H61 V94 Q61 108 47 108 H32 Q18 108 18 94 Z" style={o(BG)} />
      {/* лупа */}
      <path d="M96 84 L128 110" style={{ stroke: T, strokeWidth: 9, strokeLinecap: "round", fill: "none" }} />
      <path d="M96 84 L128 110" style={{ stroke: W, strokeWidth: 3.6, strokeLinecap: "round", fill: "none" }} />
      <circle cx="80" cy="62" r="25" style={o(W, 3)} />
      <circle cx="80" cy="62" r="19" style={{ ...o(), strokeWidth: 1.6, strokeDasharray: "2 5" }} />
      <circle cx="72" cy="56" r="3.6" style={a()} />
      <circle cx="86" cy="52" r="3" style={a()} />
      <circle cx="82" cy="68" r="4.4" style={f(ACC)} />
      <path d="M68 70 L74 74 L72 80" style={a("none", 2.4)} />
    </Frame>
  );
}

function DiThroat({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Человек в профиль: осмотр горла и носа, кашель">
      <g transform="translate(-8 2)">
        <HeadProfile />
        <circle cx="79" cy="98" r="7" style={a(ACC, 2)} />
        <path d="M79 84 V88 M91 98 H95 M67 98 H63 M70 89 L67 86 M88 89 L91 86" style={a()} />
      </g>
      {/* кашель */}
      <path d="M112 66 H134 M112 76 L132 84 M112 56 L132 48" style={a()} />
      <circle cx="140" cy="66" r="2.6" style={f(ACC)} />
      <circle cx="144" cy="82" r="2.2" style={f(ACC)} />
      <circle cx="144" cy="50" r="2.2" style={f(ACC)} />
    </Frame>
  );
}

function DiSurvey({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Планшет с опросом о самочувствии и галочками">
      <rect x="20" y="10" width="86" height="102" rx="10" style={o(W)} />
      <rect x="45" y="5" width="36" height="14" rx="5" style={o(ACC)} />
      {[34, 61, 88].map((y, i) => (
        <g key={y}>
          <rect x="31" y={y - 8} width="16" height="16" rx="4" style={o(BG, 2.4)} />
          {i < 2 ? <path d={`M34.5 ${y} L38.5 ${y + 4} L45 ${y - 5}`} style={a("none", 3)} /> : null}
          <path d={`M55 ${y - 4} H94 M55 ${y + 5} H80`} style={{ ...o(), strokeWidth: 2.4 }} />
        </g>
      ))}
      {/* карандаш */}
      <path d="M112 106 L116 94 L138 72 L146 80 L124 102 Z" style={o(BG)} />
      <path d="M116 94 L124 102 L112 106 Z" style={o(W, 2.4)} />
      <path d="M134 76 L142 84" style={o()} />
    </Frame>
  );
}

function DiThermometer({ className, title }: PosterArtProps) {
  return (
    <Frame className={className} title={title} fallback="Бесконтактный термометр у лба: 36,6">
      <g transform="translate(-4 4) scale(0.9)">
        <HeadProfile />
      </g>
      {/* термометр-пистолет */}
      <rect x="100" y="8" width="52" height="28" rx="9" style={o(W)} />
      <rect x="91" y="16" width="9" height="12" rx="3" style={o(BG, 2.4)} />
      <rect x="106" y="13" width="40" height="18" rx="5" style={o(BG, 2.2)} />
      <text x="126" y="27" style={label(14)}>36,6</text>
      <path d="M118 36 H138 L136 66 Q136 70 132 70 H124 Q120 70 120 66 Z" style={o(W)} />
      <circle cx="128" cy="52" r="3.2" style={o(ACC, 2)} />
      {/* луч */}
      <path d="M88 22 H80" style={{ ...a(), strokeDasharray: "1 6" }} />
      <circle cx="77" cy="22" r="5" style={a()} />
    </Frame>
  );
}

export const KITCHEN_ART: Record<KitchenArtName, PosterArtComponent> = {
  "chef-correct": ChefCorrect,
  "chef-wrong": ChefWrong,
  "cc-raw-ready": CcRawReady,
  "cc-boards": CcBoards,
  "cc-damaged": CcDamaged,
  "cc-sanitize": CcSanitize,
  "ds-jar": DsJar,
  "ds-fridge": DsFridge,
  "ds-spoon": DsSpoon,
  "ds-weight": DsWeight,
  "ds-portion": DsPortion,
  "di-skin": DiSkin,
  "di-throat": DiThroat,
  "di-survey": DiSurvey,
  "di-thermometer": DiThermometer,
};

// Гарантия полного набора имён на этапе компиляции.
void KITCHEN_ART_NAMES;
