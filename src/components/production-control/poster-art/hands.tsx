/**
 * Мытьё рук и обработка антисептиком. Правила рисования — `types.ts`.
 *
 * Одна и та же «рука» (ладонь, четыре пальца, большой палец, манжета)
 * переиспользуется во всех сценах с поворотом и отражением. Кожа — белая
 * заливка с тёмным контуром, чтобы рисунок читался и в Ч/б.
 */

import type { ReactNode } from "react";
import { HAND_ART_NAMES, type HandArtName, type PosterArtComponent, type PosterArtProps } from "./types";

const TEXT = "var(--pb-text)";
const ACC = "var(--pb-secondary-ink)";
const BG = "var(--pb-bg)";
const SW = 2.75;

const line = {
  fill: "none",
  stroke: TEXT,
  strokeWidth: SW,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const skin = { ...line, fill: "#fff" } as const;
const acc = { ...line, stroke: ACC } as const;
const accSolid = { fill: ACC, stroke: ACC, strokeWidth: 1, strokeLinejoin: "round" } as const;

/** Каркас сцены: мягкая подложка + подпись для диктора. */
function Scene({ title, label, className, children }: PosterArtProps & { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label={title ?? label} className={className}>
      <rect x="4" y="4" width="152" height="112" rx="22" style={{ fill: BG }} />
      {children}
    </svg>
  );
}

/** Рука: пальцами вверх, большой палец справа; (x,y) — центр ладони. */
function Hand({
  x,
  y,
  r = 0,
  s = 0.8,
  flip = false,
  back = false,
  cuff = true,
}: {
  x: number;
  y: number;
  r?: number;
  s?: number;
  flip?: boolean;
  back?: boolean;
  cuff?: boolean;
}) {
  const f = 1 / s;
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${r}) scale(${flip ? -s : s} ${s}) translate(-22 -36)`}
      style={{ strokeWidth: SW * f }}
    >
      <rect x={-4.5} y={-14} width={9} height={26} rx={4.5} transform="translate(42 45) rotate(38)" style={skin} />
      <path
        d="M6 62V26a4 4 0 0 1 8 0V14a4 4 0 0 1 8 0V8a4 4 0 0 1 8 0V12a4 4 0 0 1 8 0V62Z"
        style={skin}
      />
      <path d="M14 26V40M22 14V40M30 12V40" style={{ ...line, strokeWidth: SW * f * 0.6 }} />
      {back ? (
        <path
          d="M7.5 23a2.5 2.5 0 0 1 5 0M15.5 11a2.5 2.5 0 0 1 5 0M23.5 5.5a2.5 2.5 0 0 1 5 0M31.5 9.5a2.5 2.5 0 0 1 5 0"
          style={{ ...line, strokeWidth: SW * f * 0.55 }}
        />
      ) : (
        <path d="M11 46Q20 52 32 44" style={{ ...line, strokeWidth: SW * f * 0.55 }} />
      )}
      {cuff ? (
        <>
          <rect x={3} y={56} width={38} height={14} rx={4} style={skin} />
          <path d="M3 62H41" style={{ ...acc, strokeWidth: SW * f * 0.8 }} />
        </>
      ) : null}
    </g>
  );
}

/** Наконечник стрелки в точке (x,y); a — направление движения в градусах (0 = вправо). */
function Head({ x, y, a }: { x: number; y: number; a: number }) {
  return <path d="M-5 -4.5L0 0L-5 4.5" transform={`translate(${x} ${y}) rotate(${a})`} style={acc} />;
}

function Arrow({ d, hx, hy, a }: { d: string; hx: number; hy: number; a: number }) {
  return (
    <>
      <path d={d} style={acc} />
      <Head x={hx} y={hy} a={a} />
    </>
  );
}

function Bubbles({ items }: { items: Array<[number, number, number]> }) {
  return (
    <>
      {items.map(([cx, cy, rr], i) => (
        <circle key={i} cx={cx} cy={cy} r={rr} style={{ ...acc, fill: "#fff", strokeWidth: 1.8 }} />
      ))}
    </>
  );
}

function Drop({ x, y, k = 1 }: { x: number; y: number; k?: number }) {
  return (
    <path
      d="M0 -5C2.2 -1.8 3.6 0.2 3.6 2A3.6 3.6 0 0 1 -3.6 2C-3.6 0.2 -2.2 -1.8 0 -5Z"
      transform={`translate(${x} ${y}) scale(${k})`}
      style={accSolid}
    />
  );
}

function Sparkle({ x, y, k = 1 }: { x: number; y: number; k?: number }) {
  return (
    <path
      d="M0 -5L1.3 -1.3L5 0L1.3 1.3L0 5L-1.3 1.3L-5 0L-1.3 -1.3Z"
      transform={`translate(${x} ${y}) scale(${k})`}
      style={accSolid}
    />
  );
}

/** Толстая линия с контуром (рычаг, рукав, трубка). */
function Bar({ d, w, fill = "#fff" }: { d: string; w: number; fill?: string }) {
  return (
    <>
      <path d={d} style={{ ...line, strokeWidth: w + SW * 2 }} />
      <path d={d} style={{ ...line, stroke: fill, strokeWidth: w }} />
    </>
  );
}

/** Кран: вертикальная стойка справа, носик с (nx, ny) вниз. */
function Tap({ nx, ny, sx = 1 }: { nx: number; ny: number; sx?: number }) {
  const sx0 = nx + sx * 32;
  return (
    <g>
      <path d={`M${sx0} ${ny - 6}V${ny - 16}H${nx}V${ny}`} style={{ ...line, strokeWidth: 9 + SW * 2 }} />
      <path d={`M${sx0} ${ny - 6}V${ny - 16}H${nx}V${ny}`} style={{ ...line, stroke: "#fff", strokeWidth: 9 }} />
      <rect x={nx - 6} y={ny} width={12} height={6} rx={2.5} style={skin} />
      <path d={`M${sx0 - 7} ${ny - 26}H${sx0 + 7}`} style={{ ...acc, strokeWidth: 3.5 }} />
      <path d={`M${sx0} ${ny - 26}V${ny - 20}`} style={line} />
    </g>
  );
}

/* ---------------- сцены ---------------- */

function HwWet({ title, className }: PosterArtProps) {
  return (
    <Scene label="Смочите руки под струёй воды, кольцо снято" title={title} className={className}>
      <Tap nx={66} ny={36} />
      <path d="M66 47V52M60 48V51M72 48V51" style={{ ...acc, strokeWidth: 2.5 }} />
      <Drop x={66} y={58} k={0.85} />
      <Drop x={57} y={57} k={0.55} />
      <Drop x={76} y={57} k={0.55} />
      <Hand x={66} y={90} r={-8} s={0.8} />
      {/* снятое кольцо */}
      <ellipse cx={128} cy={92} rx={10} ry={11} style={{ ...line }} />
      <path d="M123 82L128 76L133 82" style={{ ...acc, strokeWidth: 2.4 }} />
      <circle cx={128} cy={92} r={5} style={{ ...line, strokeWidth: 2 }} />
    </Scene>
  );
}

function HwSoap({ title, className }: PosterArtProps) {
  return (
    <Scene label="Нанесите жидкое мыло на ладонь" title={title} className={className}>
      <rect x={104} y={44} width={30} height={58} rx={8} style={skin} />
      <path d="M104 66H134" style={acc} />
      <rect x={114} y={34} width={10} height={10} rx={2} style={skin} />
      <path d="M119 34V25H92V33" style={{ ...line, strokeWidth: 3.5 }} />
      <Drop x={92} y={44} k={1} />
      <Bubbles items={[[84, 66, 3], [100, 68, 2.2]]} />
      <Hand x={64} y={86} r={90} s={0.8} cuff />
    </Scene>
  );
}

function PalmsPair({ sparkles = false }: { sparkles?: boolean }) {
  return (
    <>
      <Hand x={66} y={68} r={4} s={0.82} flip />
      <Hand x={94} y={68} r={-4} s={0.82} />
      <Arrow d="M30 74Q24 62 30 44" hx={30} hy={44} a={-70} />
      <Arrow d="M130 44Q136 56 130 74" hx={130} hy={74} a={70} />
      {sparkles ? (
        <>
          <Sparkle x={30} y={30} k={1.1} />
          <Sparkle x={132} y={30} k={0.9} />
          <Sparkle x={80} y={22} k={0.8} />
        </>
      ) : (
        <Bubbles items={[[30, 28, 3.5], [40, 20, 2.2], [130, 28, 3], [121, 20, 2.2], [80, 20, 2.6]]} />
      )}
    </>
  );
}

function HwPalms({ title, className }: PosterArtProps) {
  return (
    <Scene label="Потрите ладонь о ладонь" title={title} className={className}>
      <PalmsPair />
    </Scene>
  );
}

function BacksPair({ sparkles = false }: { sparkles?: boolean }) {
  return (
    <>
      <Hand x={80} y={80} r={62} s={0.9} back />
      <Hand x={84} y={56} r={-62} s={0.9} flip />
      <Arrow d="M106 98Q124 100 130 84" hx={130} hy={84} a={-75} />
      <Arrow d="M120 28Q106 18 92 24" hx={92} hy={24} a={-160} />
      {sparkles ? (
        <>
          <Sparkle x={28} y={84} k={1} />
          <Sparkle x={30} y={40} k={0.9} />
        </>
      ) : (
        <Bubbles items={[[28, 84, 3.2], [36, 94, 2.2], [30, 40, 3], [38, 30, 2]]} />
      )}
    </>
  );
}

function HwBacks({ title, className }: PosterArtProps) {
  return (
    <Scene label="Ладонью потрите тыльную сторону другой руки" title={title} className={className}>
      <BacksPair />
    </Scene>
  );
}

function HwInterlace({ title, className }: PosterArtProps) {
  return (
    <Scene label="Пальцы в замок, скользящие движения" title={title} className={className}>
      <Hand x={56} y={68} r={90} s={0.82} cuff />
      <Hand x={104} y={68} r={-90} s={0.82} flip back cuff />
      <Arrow d="M56 30Q80 20 104 30" hx={104} hy={30} a={25} />
      <Arrow d="M104 104Q80 114 56 104" hx={56} hy={104} a={-205} />
    </Scene>
  );
}

/**
 * Большой палец открытой руки зажат в ладони другой руки (скан 97: «все руки»).
 * Обе руки узнаются как руки: слева раскрытая ладонь с пальцами, её большой
 * палец целиком скрыт в кулаке — видны согнутые пальцы, большой палец кулака
 * сверху и манжета. Ничего не торчит из кулака (2026-10-28: прежний кончик
 * зажатого пальца над кулаком читался двусмысленно). Кулак рисуется в своей
 * системе координат: кисть уходит вправо. `sparkles` — антисептик вместо пены.
 */
/**
 * Кулак: четыре согнутых пальца стопкой (их костяшки — слева), тыльная
 * сторона кисти, манжета справа и большой палец кулака поверх. (x,y) — левый
 * край пальцев посередине, r — поворот в градусах.
 */
function Fist({ x, y, r = 0 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x + 15} ${y}) rotate(${r})`}>
      {/* кисть и манжета */}
      <rect x={24} y={-14} width={18} height={27} rx={4} style={skin} />
      <path d="M33 -14V13" style={acc} />
      <rect x={4} y={-19} width={25} height={36} rx={9} style={skin} />
      {/* четыре согнутых пальца */}
      <rect x={-15} y={-17} width={28} height={9} rx={4.5} style={skin} />
      <rect x={-15} y={-8} width={28} height={9} rx={4.5} style={skin} />
      <rect x={-14} y={1} width={27} height={8.5} rx={4.25} style={skin} />
      <rect x={-12} y={9.5} width={24} height={8} rx={4} style={skin} />
      {/* большой палец кулака поверх */}
      <rect x={-9} y={-25} width={33} height={9.5} rx={4.75} transform="rotate(-8 7 -20)" style={skin} />
    </g>
  );
}

function ThumbScene({ sparkles = false }: { sparkles?: boolean }) {
  return (
    <>
      <Hand x={54} y={72} r={-14} s={0.98} />
      <Fist x={62} y={71} r={24} />
      <Arrow d="M40 26Q74 2 110 26" hx={110} hy={26} a={35} />
      {sparkles ? (
        <>
          <Sparkle x={24} y={44} k={1.1} />
          <Sparkle x={132} y={96} k={0.8} />
        </>
      ) : (
        <Bubbles items={[[22, 46, 3.5], [30, 36, 2.2], [132, 96, 3], [140, 86, 2]]} />
      )}
    </>
  );
}

function HwThumbs({ title, className }: PosterArtProps) {
  return (
    <Scene label="Обхватите большой палец и потрите круговыми движениями" title={title} className={className}>
      <ThumbScene />
    </Scene>
  );
}

function FingertipScene({ sparkles = false, double = false }: { sparkles?: boolean; double?: boolean }) {
  return (
    <>
      <Hand x={72} y={72} r={-6} s={0.95} />
      {/* собранные кончики пальцев */}
      <path d="M100 18L118 26L94 54Q90 58 86 55L84 51Z" style={skin} />
      <path d="M96 28L102 38" style={{ ...line, strokeWidth: 1.8 }} />
      {double ? (
        <>
          <Arrow d="M62 66Q70 54 86 62" hx={86} hy={62} a={35} />
          <Arrow d="M96 80Q86 90 74 82" hx={74} hy={82} a={-145} />
        </>
      ) : (
        <Arrow d="M64 70Q64 52 84 52Q98 54 98 68" hx={98} hy={68} a={80} />
      )}
      {sparkles ? (
        <>
          <Sparkle x={30} y={36} k={1.1} />
          <Sparkle x={130} y={86} k={0.9} />
        </>
      ) : (
        <Bubbles items={[[30, 36, 3.5], [40, 28, 2.2], [130, 88, 3], [122, 98, 2]]} />
      )}
    </>
  );
}

function HwFingertips({ title, className }: PosterArtProps) {
  return (
    <Scene label="Кончиками пальцев потрите ладонь другой руки" title={title} className={className}>
      <FingertipScene />
    </Scene>
  );
}

function HwRinse({ title, className }: PosterArtProps) {
  return (
    <Scene label="Смойте мыло водой" title={title} className={className}>
      <Tap nx={80} ny={34} sx={-1} />
      <path d="M80 45V52M74 46V50M86 46V50" style={{ ...acc, strokeWidth: 2.5 }} />
      <Hand x={68} y={88} r={-4} s={0.7} flip />
      <Hand x={92} y={88} r={4} s={0.7} />
      <Bubbles items={[[34, 78, 4], [26, 92, 2.6], [44, 96, 2.2], [128, 78, 4], [136, 92, 2.6], [118, 98, 2.2]]} />
      <Drop x={48} y={64} k={0.7} />
      <Drop x={112} y={64} k={0.7} />
    </Scene>
  );
}

function HwDry({ title, className }: PosterArtProps) {
  return (
    <Scene label="Вытрите руки насухо бумажным полотенцем" title={title} className={className}>
      <Hand x={68} y={52} r={4} s={0.8} flip cuff={false} />
      <Hand x={92} y={52} r={-4} s={0.8} cuff={false} />
      {/* бумажное полотенце */}
      <path d="M36 64H124V94Q112 100 100 94T76 94T52 94T36 94Z" style={skin} />
      <path d="M52 76H108M52 84H96" style={{ ...acc, strokeWidth: 2.2 }} />
      <Sparkle x={30} y={36} k={1} />
      <Sparkle x={132} y={34} k={0.8} />
    </Scene>
  );
}

function HwTapTowel({ title, className }: PosterArtProps) {
  return (
    <Scene label="Закройте кран через бумажное полотенце" title={title} className={className}>
      {/* кран */}
      <rect x={18} y={46} width={92} height={14} rx={6} style={skin} />
      <rect x={24} y={60} width={12} height={10} rx={3} style={skin} />
      <rect x={71} y={30} width={8} height={16} rx={2} style={skin} />
      <Hand x={74} y={92} r={-8} s={0.85} />
      {/* полотенце поверх вентиля */}
      <path d="M62 14H98L96 66H64Q58 40 62 14Z" style={skin} />
      <path d="M70 26H90M70 36H88M70 46H86" style={{ ...acc, strokeWidth: 2.2 }} />
      <Arrow d="M110 20Q130 26 126 44" hx={126} hy={44} a={85} />
      <Drop x={30} y={82} k={0.8} />
    </Scene>
  );
}

function HwTimer({ title, className }: PosterArtProps) {
  return (
    <Scene label="Секундомер: не меньше 20 секунд" title={title} className={className}>
      <rect x={73} y={8} width={14} height={9} rx={3} style={skin} />
      <path d="M80 17V24" style={line} />
      <path d="M118 28L124 22" style={{ ...line, strokeWidth: 5 }} />
      <circle cx={80} cy={66} r={40} style={skin} />
      <path
        d="M80 32A34 34 0 0 1 114 66"
        style={{ ...acc, strokeWidth: 4 }}
      />
      <path d="M80 36V40M80 92V96M50 66H54M106 66H110" style={{ ...line, strokeWidth: 2.2 }} />
      <text
        x={80}
        y={74}
        textAnchor="middle"
        style={{ fill: TEXT, fontSize: 28, fontWeight: 800, fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        20
      </text>
      <text
        x={80}
        y={90}
        textAnchor="middle"
        style={{ fill: ACC, fontSize: 9, fontWeight: 700, fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        сек
      </text>
    </Scene>
  );
}

function AsDispenser({ title, className }: PosterArtProps) {
  return (
    <Scene label="Нажмите локтем на рычаг дозатора, подставив ладонь" title={title} className={className}>
      <rect x={96} y={10} width={44} height={40} rx={9} style={skin} />
      <rect x={108} y={20} width={20} height={12} rx={3} style={{ ...acc, fill: "#fff" }} />
      <rect x={110} y={50} width={14} height={8} rx={3} style={skin} />
      {/* рычаг и локоть */}
      <Bar d="M98 42L78 52" w={5} />
      <Bar d="M30 22L64 50" w={14} />
      <path d="M36 27L48 37" style={{ ...acc, strokeWidth: 2.2 }} />
      <Drop x={117} y={70} k={0.9} />
      <Hand x={112} y={96} r={-90} s={0.64} />
      <Sparkle x={142} y={88} k={0.8} />
    </Scene>
  );
}

function AsPalms({ title, className }: PosterArtProps) {
  return (
    <Scene label="Потрите ладонь о ладонь, захватывая запястья" title={title} className={className}>
      <PalmsPair sparkles />
    </Scene>
  );
}

function AsBacks({ title, className }: PosterArtProps) {
  return (
    <Scene label="Потрите тыльную сторону кисти и межпальцевые промежутки" title={title} className={className}>
      <BacksPair sparkles />
    </Scene>
  );
}

/**
 * Тыльная сторона согнутых пальцев — по ладони другой руки: раскрытая ладонь,
 * в её середину упирается костяшками кулак, кисть и рукав уходят вправо.
 * Стрелка в обе стороны — движение вверх-вниз по ладони (2026-10-28: прежние
 * пальцы вытянутым «валиком» над рукой читались двусмысленно).
 */
function AsKnuckles({ title, className }: PosterArtProps) {
  return (
    <Scene label="Тыльной стороной согнутых пальцев потрите ладонь другой руки" title={title} className={className}>
      <Hand x={54} y={70} r={-6} s={0.98} />
      <Fist x={52} y={76} r={-8} />
      <Arrow d="M128 30Q140 58 128 86" hx={128} hy={86} a={112} />
      <Head x={128} y={30} a={-112} />
      <Sparkle x={24} y={40} k={1} />
      <Sparkle x={22} y={92} k={0.8} />
    </Scene>
  );
}

function AsThumbs({ title, className }: PosterArtProps) {
  return (
    <Scene label="Круговыми движениями потрите большие пальцы" title={title} className={className}>
      <ThumbScene sparkles />
    </Scene>
  );
}

function AsFingertips({ title, className }: PosterArtProps) {
  return (
    <Scene label="Кончиками пальцев потрите ладонь другой руки" title={title} className={className}>
      <FingertipScene sparkles double />
    </Scene>
  );
}

const COMPONENTS: Record<HandArtName, PosterArtComponent> = {
  "hw-wet": HwWet,
  "hw-soap": HwSoap,
  "hw-palms": HwPalms,
  "hw-backs": HwBacks,
  "hw-interlace": HwInterlace,
  "hw-thumbs": HwThumbs,
  "hw-fingertips": HwFingertips,
  "hw-rinse": HwRinse,
  "hw-dry": HwDry,
  "hw-tap-towel": HwTapTowel,
  "hw-timer": HwTimer,
  "as-dispenser": AsDispenser,
  "as-palms": AsPalms,
  "as-backs": AsBacks,
  "as-knuckles": AsKnuckles,
  "as-thumbs": AsThumbs,
  "as-fingertips": AsFingertips,
};

export const HAND_ART: Record<HandArtName, PosterArtComponent> = Object.fromEntries(
  HAND_ART_NAMES.map((name) => [name, COMPONENTS[name]]),
) as Record<HandArtName, PosterArtComponent>;
