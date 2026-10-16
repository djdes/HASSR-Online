"use client";

import { useTranslations } from "next-intl";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import { FORMAT_LOCALES } from "@/i18n/locales";
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  BellRing,
  Check,
  CookingPot,
  Lightbulb,
  LightbulbOff,
  Mail,
  MapPin,
  QrCode,
  Refrigerator,
  Send,
  Thermometer,
  Wifi,
} from "lucide-react";

import { HEALTH_CONFIRMATIONS, healthDecision, type HealthConfirmationKey } from "@/lib/health-qr";
import { HYGIENE_V2_COLUMNS } from "@/lib/hygiene-v2";

import { ease, interpolate, progress, windowed } from "./clock";
import {
  CHAPTER_SECONDS,
  DEMO,
  FPS,
  FRIDGE_NORM,
  JOURNALS,
  bodyFever,
  chapterAt,
  fridgeOutOfRange,
  type Chapter,
} from "./chapters";
import type { QrMatrix } from "./qr-sticker";

const HEALTH_MESSAGE_KEYS = {
  temperature: { confirmation: "health.confirmation.temperature", complaint: "health.complaint.temperature" },
  infection: { confirmation: "health.confirmation.infection", complaint: "health.complaint.infection" },
  respiratorySkin: { confirmation: "health.confirmation.respiratorySkin", complaint: "health.complaint.respiratorySkin" },
} as const satisfies Record<HealthConfirmationKey, { confirmation: string; complaint: string }>;

const HYGIENE_COLUMN_KEYS = {
  n: "number",
  name: "employee",
  position: "position",
  temperature: "temperatureSignature",
  infection: "infectionSignature",
  respiratorySkin: "respiratoryAndSkinSignature",
  result: "inspectionResult",
  verifier: "verifierSignature",
} as const;

/**
 * Кадр ролика — чистая функция `frame` и значений «Попробуйте сами».
 *
 * Все цвета внутри сцены — inline: ночная тема публичных страниц
 * перекрашивает `.bg-white`, `.text-[#0b1024]` и ещё десятки классов, а
 * бумага журнала и экран телефона ночью должны остаться бумагой и экраном.
 *
 * Размеры — в `em` от корня каждой детали; корень берёт `cqw` от сцены
 * (`@container`). Поэтому кадр одинаково собран на 360 px и на 1440 px, а
 * первый кадр, отрисованный на сервере, не прыгает после гидрации.
 */

export type SceneDay = {
  day: number;
  month: number;
  year: number;
  daysInMonth: number;
  /** «сентябрь 2026» */
  monthLabel: string;
};

export type SceneProps = {
  frame: number;
  fridgeTemp: number;
  bodyTemp: number;
  today: SceneDay;
  qr: QrMatrix;
};

const P = {
  stage: "#0f1430",
  bezel: "#070914",
  screen: "#f4f5fa",
  card: "#ffffff",
  ink: "#131728",
  ink2: "#454a62",
  muted: "#7d8198",
  faint: "#aeb1c2",
  line: "#e2e4ee",
  lineStrong: "#cfd2e2",
  indigo: "#5566f6",
  indigoDeep: "#3848c7",
  indigoTint: "#eceffe",
  ok: "#16a34a",
  okTint: "#e9f8ee",
  okInk: "#146c31",
  bad: "#d2453d",
  badTint: "#fdeeec",
  badInk: "#a3342c",
  amberTint: "#fff5dc",
  amberLine: "#f6dc92",
  amberInk: "#6f4400",
  paper: "#fffdf8",
  paperInk: "#1c1c22",
  rule: "#3a3a42",
  paperHead: "#efeee9",
  highlight: "#e4e8ff",
} as const;

/* ---------------------------------------------------------------------
 * Мир и камера: 4:5 на телефоне, 16:9 от md.
 *
 * Кадр — окно камеры в вертикальный «мир» высотой WORLD_H сцен: сверху
 * место и телефон со сканированием, снизу — журнал. Глава открывается
 * наездом на видоискатель, камера отъезжает к телефону, а в момент
 * сохранения спускается к журналу вслед за значением. Координаты мира —
 * в процентах ширины (x) и высоты сцены (y, 0…WORLD_H·100); в классах
 * Tailwind ниже они уже пересчитаны в проценты высоты мира.
 * ------------------------------------------------------------------- */

const WORLD_H = 1.8;
/** На сколько высот сцены камера опускается к журналу: низ телефона с
    итогом остаётся в кадре над бланком — видно, откуда пришла запись. */
const PAN = 0.7;

const POS = {
  /* Экранные (поверх камеры). */
  place: "left-[4%] top-[3%] max-w-[92%] [font-size:3.1cqw] md:left-[35.5%] md:top-[7%] md:max-w-[60%] md:[font-size:1.2cqw]",
  toast: "left-[30%] right-[3%] top-[72%] [font-size:2.6cqw] md:left-auto md:right-[2.5%] md:top-[5%] md:w-[30%] md:[font-size:1.02cqw]",
  /* Мировые (в % высоты мира): телефон 9…92 % сцены на телефоне и 6…93 %
     на десктопе, шаги справа от него, бланк 96…176 %. */
  phone: "left-[4%] top-[5%] w-[52%] md:left-[6%] md:top-[3.333%] md:w-[24.5%]",
  rail: "left-[59.5%] right-[3%] top-[7.778%] [font-size:2.75cqw] md:left-[35.5%] md:right-auto md:top-[11.111%] md:w-[27%] md:[font-size:1.25cqw]",
  paper: "left-[4%] right-[4%] top-[53.333%] h-[44.444%] [font-size:3.1cqw] md:left-[3.5%] md:right-[3.5%] md:[font-size:1.36cqw]",
  /* Камера: точка наезда (видоискатель) и сила наезда — по раскладке. */
  camera: "[--fx:30%] [--fy:25.5%] [--z0:1.3] md:[--fx:20%] md:[--fy:25%] md:[--z0:1.55]",
} as const;

/** Монохромный шум: зерно плёнки поверх кадра и фактура бумаги. */
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Точка мира → CSS: y в процентах высоты мира. */
function worldY(y: number): string {
  return `${(y / WORLD_H).toFixed(3)}%`;
}

type WorldPoint = { x: number; y: number };
/** `tag` — где встаёт метка «когда и кто»: под графой или справа от неё (на пустых днях). */
type Leg = { from: WorldPoint; to: WorldPoint; tag?: "below" | "right" };
/** Путь значения из телефона в графу — своя пара точек на каждую раскладку. */
type FlightPath = { mobile: Leg; desktop: Leg };

/**
 * Время главы и положение камеры — общие для всех деталей кадра: телефон
 * покачивается в руке, бланк «поднимается» навстречу камере, фон уходит в
 * глубину. Контекст, а не пропсы: так не надо тянуть `t` через шесть сцен.
 */
type CameraState = { t: number; frame: number; pan: number; push: number; journalAt: number };
const CameraContext = createContext<CameraState>({ t: 0, frame: 0, pan: 0, push: 0, journalAt: 99 });

/** Закрытая форма пружины с критическим затуханием: 0 → 1, без перелёта. */
function spring(t: number, from: number, omega = 6.4): number {
  if (t <= from) return 0;
  const x = (t - from) * omega;
  return 1 - (1 + x) * Math.exp(-x);
}

/** Детерминированный «шум» для зерна и дрожания: одно число на кадр. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ---------------------------------------------------------------------
 * Мелкие детали
 * ------------------------------------------------------------------- */

function fade(opacity: number, extra?: CSSProperties): CSSProperties {
  return { opacity, visibility: opacity <= 0.001 ? "hidden" : "visible", ...extra };
}

/** Ввод по буквам: сколько символов строки уже «напечатано». */
function typed(text: string, t: number, from: number, perChar = 0.09): string {
  if (t < from) return "";
  return text.slice(0, Math.min(text.length, Math.floor((t - from) / perChar) + 1));
}

/** Число как в печатной форме журнала (`formatNumberShort` в document-pdf). */
function pdfNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value).replace(/-/g, "−");
}

function decimalLabel(value: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value).replace(/-/g, "−");
}

function dateLabel(day: SceneDay, locale: string, d = day.day): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(day.year, day.month - 1, d)));
}

function weekday(day: SceneDay, d: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(day.year, day.month - 1, d)));
}

/** Касание пальцем: круг расходится и гаснет. */
function Tap({ t, at, x, y }: { t: number; at: number; x: string; y: string }) {
  const p = progress(t, at, 0.45, ease.out);
  if (t < at || p >= 1) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: "2.6em",
        height: "2.6em",
        marginLeft: "-1.3em",
        marginTop: "-1.3em",
        borderRadius: "999px",
        background: "rgba(85,102,246,0.28)",
        border: "0.12em solid rgba(85,102,246,0.55)",
        transform: `scale(${0.5 + p * 0.9})`,
        opacity: 1 - p,
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Галка «Сохранено» — как в продукте (`QR_CHECK_SVG` в `src/lib/qr-pin-ui.ts`):
 * залитый сине-зелёный круг с ореолом и белая галка, без контурного кольца.
 * Круг появляется, затем рисуется галка. Кадровая, не CSS.
 */
function DrawnCheck({ t, at, size = "4.4em" }: { t: number; at: number; size?: string }) {
  const mark = progress(t, at + 0.2, 0.3, ease.out);
  const pop = interpolate(t, [at, at + 0.35], [0.7, 1], { easing: ease.outBack });
  return (
    <div
      style={{
        width: size,
        height: size,
        margin: "0 auto",
        // Как на настоящих QR-страницах (qr-pin-ui.ts): скруглённый квадрат, не круг — не путать со Сбером.
        borderRadius: "28%",
        background: "#5566f6",
        boxShadow: "0 0 0 0.3em rgba(85,102,246,.14)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${pop})`,
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: "60%", height: "60%" }} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="m6.5 12.5 3.6 3.6 7.4-7.6" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - mark} />
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Телефон и экраны QR-формы
 * ------------------------------------------------------------------- */

/**
 * Телефон в руке: металлическая рамка с кнопками, стекло с бликом, тень на
 * «полу». Наклон небольшой и живой — рука чуть покачивается, блик ходит
 * вслед за наклоном. `ping` — момент распознавания QR: от корпуса
 * расходятся две волны.
 */
function PhoneFrame({ clock, children, ping }: { clock: string; children: ReactNode; ping?: number }) {
  const { t, pan } = useContext(CameraContext);
  const tiltY = -5 + Math.sin(t * 0.8) * 1.4;
  const tiltX = 3 + Math.cos(t * 0.6) * 0.9;
  const roll = -0.7 + Math.sin(t * 0.45) * 0.45;
  const bob = Math.sin(t * 0.9) * 0.22;
  const glare = 46 + tiltY * 5;
  return (
    <div className={`absolute @container ${POS.phone}`}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "8%",
          right: "4%",
          bottom: "-3.5%",
          height: "7%",
          borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(0,0,0,0.6), rgba(0,0,0,0))",
        }}
      />
      <div
        style={{
          position: "relative",
          fontSize: "5.3cqw",
          width: "100%",
          aspectRatio: "1 / 2",
          borderRadius: "2.5em",
          padding: "0.2em",
          background: "linear-gradient(150deg,#727892 0%,#262934 16%,#0d0f15 46%,#2c303c 74%,#808699 100%)",
          boxShadow: "0 2.8em 4.4em -1.6em rgba(0,0,0,0.78), 0 1em 1.8em -0.9em rgba(0,0,0,0.55)",
          transform: `perspective(60em) translateY(${bob}em) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${roll}deg)`,
          transformOrigin: "50% 60%",
        }}
      >
        {[
          { side: "left", top: "17%", height: "5%" },
          { side: "left", top: "25%", height: "9%" },
          { side: "right", top: "22%", height: "12%" },
        ].map((button) => (
          <span
            key={`${button.side}-${button.top}`}
            aria-hidden="true"
            style={{
              position: "absolute",
              [button.side]: "-0.12em",
              top: button.top,
              width: "0.14em",
              height: button.height,
              borderRadius: "0.1em",
              background: "linear-gradient(90deg,#3e4251,#a3a9bd,#3e4251)",
            }}
          />
        ))}
        {ping !== undefined
          ? [0, 0.14].map((delay) => {
              const wave = progress(t, ping + delay, 0.55, ease.out);
              if (t < ping + delay || wave >= 1) return null;
              return (
                <span
                  key={delay}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "2.5em",
                    border: "0.12em solid rgba(124,245,192,0.9)",
                    transform: `scale(${1 + wave * 0.14})`,
                    opacity: 1 - wave,
                    pointerEvents: "none",
                  }}
                />
              );
            })
          : null}
        <div style={{ height: "100%", borderRadius: "2.32em", padding: "0.24em", background: "#040507", boxShadow: "inset 0 0 0 0.05em rgba(255,255,255,0.1)" }}>
        <div
          style={{
            position: "relative",
            height: "100%",
            borderRadius: "2.08em",
            overflow: "hidden",
            background: P.screen,
            color: P.ink,
            lineHeight: 1.3,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "0 0 auto 0",
              height: "1.9em",
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 1.3em",
              fontSize: "0.72em",
              fontWeight: 600,
              color: "#ffffff",
              background: "#0b1024",
            }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{clock}</span>
            <span style={{ width: "4.6em", height: "1.2em", borderRadius: "999px", background: "#000000", boxShadow: "inset 0 0 0 0.06em rgba(255,255,255,0.06)" }} />
            <span style={{ display: "inline-flex", gap: "0.3em", alignItems: "center" }}>
              <Wifi style={{ width: "1.05em", height: "1.05em" }} />
              <span style={{ width: "1.6em", height: "0.8em", borderRadius: "0.2em", border: "0.1em solid rgba(255,255,255,0.8)", padding: "0.08em" }}>
                <span style={{ display: "block", width: "72%", height: "100%", borderRadius: "0.08em", background: "rgba(255,255,255,0.9)" }} />
              </span>
            </span>
          </div>
          <div style={{ position: "absolute", inset: "1.9em 0 0 0", display: "flex", flexDirection: "column" }}>{children}</div>
          {/* Камера у журнала: телефон уходит из фокуса в тень. */}
          {pan > 0.01 ? <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 8, background: "#080b1a", opacity: pan * 0.62 }} /> : null}
          {/* Стекло: мягкий диагональный блик идёт за наклоном телефона. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 9,
              pointerEvents: "none",
              background: `linear-gradient(115deg, rgba(255,255,255,0) ${glare - 20}%, rgba(255,255,255,0.12) ${glare}%, rgba(255,255,255,0) ${glare + 18}%)`,
            }}
          />
        </div>
        </div>
      </div>
    </div>
  );
}

/** Шапка QR-страницы — как `QrPageShell`: организация и журнал. */
function QrHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.55em",
        padding: "0.7em 0.9em 0.8em",
        color: "#ffffff",
        background:
          "radial-gradient(circle at 8% 0%, rgba(85,102,246,.55), transparent 55%), radial-gradient(circle at 100% 100%, rgba(122,92,255,.4), transparent 55%), #0b1024",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: "1.9em",
          height: "1.9em",
          flex: "none",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "0.6em",
          background: "rgba(255,255,255,0.1)",
          boxShadow: "inset 0 0 0 0.06em rgba(255,255,255,.2)",
        }}
      >
        <QrCode style={{ width: "1em", height: "1em" }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "0.6em", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {DEMO.org}
        </span>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontSize: "0.86em",
            fontWeight: 600,
            lineHeight: 1.22,
          }}
        >
          {title}
        </span>
      </span>
    </div>
  );
}

function WhoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: "0.75em", border: `0.06em solid ${P.line}`, background: P.card, padding: "0.45em 0.7em", marginBottom: "0.5em" }}>
      <div style={{ fontSize: "0.58em", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: P.faint }}>{label}</div>
      <div style={{ fontSize: "0.95em", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

function PrimaryButton({ children, pressed = 0, color = P.indigo, style }: { children: ReactNode; pressed?: number; color?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.4em",
        minHeight: "2.5em",
        borderRadius: "0.85em",
        background: color,
        color: "#ffffff",
        fontWeight: 600,
        fontSize: "0.92em",
        textAlign: "center",
        padding: "0 0.6em",
        transform: `scale(${1 - pressed * 0.04})`,
        filter: `brightness(${1 - pressed * 0.12})`,
        boxShadow: "0 0.6em 1.4em -0.8em rgba(85,102,246,0.8)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Нажатие кнопки: 0 → 1 → 0 вокруг момента `at`. */
function press(t: number, at: number): number {
  return windowed(t, at - 0.05, at + 0.22, 0.1);
}

/** Слой экрана: въезжает справа, уезжает влево. */
function Screen({ t, from, to, children, pad = true }: { t: number; from: number; to: number; children: ReactNode; pad?: boolean }) {
  if (t < from - 0.01 || t > to + 0.01) return null;
  const enter = progress(t, from, 0.3, ease.out);
  const leave = progress(t, to - 0.25, 0.25, ease.inOut);
  const x = (1 - enter) * 1.8 - leave * 1.8;
  const opacity = Math.min(enter, 1 - leave);
  return (
    <div style={fade(opacity, { position: "absolute", inset: 0, transform: `translateX(${x}em)` })}>
      <div style={{ padding: pad ? "0.75em 0.8em" : 0, height: "100%", position: "relative" }}>{children}</div>
    </div>
  );
}

type ScanObject = "fridge" | "thermometer" | "lamp" | "fryer";

/** Видоискатель камеры: объект, золотая наклейка, рамка распознавания. */
/**
 * Куда смотрит камера и где висит наклейка — по главам. `pos` —
 * objectPosition фото (прицел на осмысленную поверхность: дверца, стена,
 * стальная панель), `left/top` — точка наклейки в кадре, `tilt` — наклон
 * «приклеена руками», `title` — что написано на наклейке (объект — как в
 * печатных наклейках продукта, у гигиены — название журнала).
 */
const VIEWFINDER_LAYOUT: Record<
  ScanObject,
  { pos: string; left: string; top: string; tilt: number; title: string; zoom?: { scale: number; origin: string } }
> = {
  // Телефон обрезается низом сцены: видимая зона видоискателя — верхняя
  // половина экрана, наклейки держим в top ≤ 45%. Узкий кроп почти не
  // слушается objectPosition, поэтому на дверцу и фритюрницу камера
  // «подходит ближе» зумом (transform-origin в точку объекта на фото).
  fridge: { pos: "50% 50%", left: "52%", top: "42%", tilt: -2.5, title: DEMO.fridge, zoom: { scale: 2.4, origin: "55% 56%" } },
  thermometer: { pos: "40% 50%", left: "50%", top: "44%", tilt: 2, title: JOURNALS.hygiene },
  lamp: { pos: "50% 34%", left: "50%", top: "44%", tilt: -2, title: DEMO.lamp },
  fryer: { pos: "50% 50%", left: "50%", top: "40%", tilt: 2.5, title: DEMO.fryer, zoom: { scale: 2.2, origin: "58% 96%" } },
};

function Viewfinder({ t, object, qr, bodyTemp, photo }: { t: number; object: ScanObject; qr: QrMatrix; bodyTemp: number; photo?: string }) {
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  const hide = progress(t, 0.85, 0.25, ease.inOut);
  if (hide >= 1) return null;
  const lock = progress(t, 0.35, 0.3, ease.out);
  const found = progress(t, 0.55, 0.2, ease.out);
  const bracket = interpolate(lock, [0, 1], [1.35, 1]);
  const scan = (t * 1.6) % 1;
  const layout = VIEWFINDER_LAYOUT[object];
  // Камера «ищет» фокус: кадр на миг мылится и собирается к моменту захвата.
  const focusBlur = 3.4 * windowed(t, 0.04, 0.42, 0.14);
  // Захват QR — короткая вспышка, как у настоящего сканера.
  const flash = windowed(t, 0.55, 0.8, 0.06) * 0.55;
  return (
    <div style={fade(1 - hide, { position: "absolute", inset: 0, zIndex: 4, background: "#1a1f33", overflow: "hidden" })}>
      {photo ? (
        <>
          {/* Камера смотрит на настоящее место; лёгкий дрейф — телефон в
              руках, а не штатив. Всё — функции t, перемотка детерминирована. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: layout.pos,
              filter: `brightness(0.9) saturate(0.95)${focusBlur > 0.05 ? ` blur(${focusBlur.toFixed(2)}px)` : ""}`,
              transformOrigin: layout.zoom?.origin ?? "50% 50%",
              transform: `translate(${Math.sin(t * 1.1) * 0.8}%, ${Math.cos(t * 0.8) * 0.6}%) scale(${layout.zoom?.scale ?? 1.07})`,
            }}
          />
          {/* Свет — на наклейку: остальное притемняется, глазу ясно, что сканировать. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(46% 42% at ${layout.left} ${layout.top}, rgba(4,6,14,0) 42%, rgba(4,6,14,0.66) 100%)`,
            }}
          />
          {object === "thermometer" ? <ThermometerReadout bodyTemp={bodyTemp} /> : null}
        </>
      ) : (
        <ObjectArt object={object} bodyTemp={bodyTemp} />
      )}
      <div
        style={{
          position: "absolute",
          left: layout.left,
          top: layout.top,
          width: "6.6em",
          transform: `translate(-50%, -50%) rotate(${layout.tilt}deg) scale(${1 + found * 0.05})`,
        }}
      >
        {/* Наклейка — как печатает продукт (формат «наклейка»): белая
            карточка, QR, название объекта, организация. Приклеена с
            наклоном и бросает тень на поверхность. */}
        <div
          style={{
            borderRadius: "0.7em",
            background: "#ffffff",
            padding: "0.5em 0.5em 0.45em",
            boxShadow: "0 1.1em 2.4em -0.7em rgba(0,0,0,0.7), 0 0.15em 0.45em rgba(0,0,0,0.4)",
          }}
        >
          {/* Фирменный QR с полосой «Отсканировать» — SVG собран на сервере (qr-matrix.ts). */}
          <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr.printed }} />
          <div style={{ marginTop: "0.38em", textAlign: "center", color: P.ink, fontWeight: 700, fontSize: "0.6em", lineHeight: 1.15 }}>{object === "thermometer" ? journal("hygiene") : layout.title}</div>
          <div style={{ marginTop: "0.18em", textAlign: "center", color: P.muted, fontSize: "0.5em", lineHeight: 1.1 }}>{DEMO.org}</div>
        </div>
        <div
          style={{
            position: "absolute",
            inset: "-0.5em",
            transform: `scale(${bracket})`,
            opacity: 0.4 + lock * 0.6,
          }}
        >
          {[0, 1, 2, 3].map((corner) => (
            <span
              key={corner}
              style={{
                position: "absolute",
                width: "1.2em",
                height: "1.2em",
                borderColor: found > 0.5 ? "#7cf5c0" : "#ffffff",
                borderStyle: "solid",
                borderWidth: 0,
                ...(corner === 0 ? { left: 0, top: 0, borderLeftWidth: "0.2em", borderTopWidth: "0.2em", borderTopLeftRadius: "0.5em" } : {}),
                ...(corner === 1 ? { right: 0, top: 0, borderRightWidth: "0.2em", borderTopWidth: "0.2em", borderTopRightRadius: "0.5em" } : {}),
                ...(corner === 2 ? { left: 0, bottom: 0, borderLeftWidth: "0.2em", borderBottomWidth: "0.2em", borderBottomLeftRadius: "0.5em" } : {}),
                ...(corner === 3 ? { right: 0, bottom: 0, borderRightWidth: "0.2em", borderBottomWidth: "0.2em", borderBottomRightRadius: "0.5em" } : {}),
              }}
            />
          ))}
          {found < 0.5 ? (
            <span
              style={{
                position: "absolute",
                left: "0.3em",
                right: "0.3em",
                top: `${8 + scan * 84}%`,
                height: "0.12em",
                background: "rgba(124,245,192,0.9)",
                boxShadow: "0 0 0.6em rgba(124,245,192,0.8)",
              }}
            />
          ) : null}
        </div>
      </div>
      <div
        style={fade(found, {
          position: "absolute",
          left: "50%",
          bottom: "16%",
          transform: `translate(-50%, ${(1 - found) * 0.6}em)`,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35em",
          whiteSpace: "nowrap",
          padding: "0.45em 0.8em",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.94)",
          color: P.ink,
          fontSize: "0.72em",
          fontWeight: 600,
        })}
      >
        <QrCode style={{ width: "1.1em", height: "1.1em", color: P.indigo }} />
        {tr("storefrontLink")}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: "1.2em", textAlign: "center", fontSize: "0.66em", color: "rgba(255,255,255,0.75)" }}>
        {tr("scanInstruction")}</div>
      {flash > 0 ? <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: flash }} /> : null}
    </div>
  );
}

/** Показание настенного термометра — поверх фото или рисунка раздевалки. */
function ThermometerReadout({ bodyTemp }: { bodyTemp: number }) {
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const fever = bodyFever(bodyTemp);
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "66%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "0.4em",
        padding: "0.4em 0.7em",
        borderRadius: "0.7em",
        background: "#e9ecf5",
        color: fever ? P.bad : P.ink,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        boxShadow: "0 0.3em 1.2em rgba(0,0,0,0.35)",
      }}
    >
      <Thermometer style={{ width: "1.1em", height: "1.1em" }} />
      {decimalLabel(bodyTemp, locale)} °C
    </div>
  );
}

/** Условный рисунок того, на чём висит наклейка (фолбэк без фото). */
function ObjectArt({ object, bodyTemp }: { object: ScanObject; bodyTemp: number }) {
  if (object === "fridge") {
    return (
      <div style={{ position: "absolute", left: "12%", right: "12%", top: "8%", bottom: "-6%", borderRadius: "1.2em", background: "linear-gradient(160deg,#dfe3ef,#b9bfd3)", boxShadow: "inset 0 0 0 0.1em rgba(255,255,255,0.5)" }}>
        <span style={{ position: "absolute", right: "10%", top: "20%", width: "0.45em", height: "5em", borderRadius: "0.3em", background: "#8d93aa" }} />
      </div>
    );
  }
  if (object === "thermometer") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#39405c,#262b41)" }} />
        <ThermometerReadout bodyTemp={bodyTemp} />
      </>
    );
  }
  if (object === "lamp") {
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#3a4160,#252a3f)" }} />
        <div style={{ position: "absolute", left: "10%", right: "10%", top: "12%", height: "1.6em", borderRadius: "0.8em", background: "#cfd4e6", boxShadow: "0 0 1.4em rgba(140,160,255,0.45)" }} />
      </>
    );
  }
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#434a63,#2a2f45)" }} />
      <div style={{ position: "absolute", left: "10%", right: "10%", top: "58%", bottom: "-4%", borderRadius: "0.8em 0.8em 0 0", background: "linear-gradient(180deg,#c9ceda,#a4aabd)" }} />
    </>
  );
}

function EmployeeList({ t, tapAt, label }: { t: number; tapAt: number; label: string }) {
  const people = [DEMO.cook, ...DEMO.others];
  const chosen = t >= tapAt + 0.1;
  return (
    <div style={{ position: "relative" }}>
      <div style={{ fontSize: "0.62em", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: P.muted, margin: "0.2em 0.1em 0.45em" }}>{label}</div>
      {people.map((person, index) => {
        const on = chosen && index === 0;
        return (
          <div
            key={person.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.55em",
              padding: "0.55em 0.65em",
              marginBottom: "0.4em",
              borderRadius: "0.8em",
              border: `0.07em solid ${on ? P.indigo : P.line}`,
              background: on ? P.indigoTint : P.card,
            }}
          >
            <span style={{ display: "inline-flex", width: "1.7em", height: "1.7em", flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "999px", background: P.indigoTint, color: P.indigoDeep, fontSize: "0.72em", fontWeight: 700 }}>
              {person.name
                .split(" ")
                .map((part) => part[0])
                .join("")}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "0.86em", fontWeight: 600 }}>{person.name}</span>
              <span style={{ display: "block", fontSize: "0.68em", color: P.muted }}>{person.position}</span>
            </span>
            {on ? <Check style={{ marginLeft: "auto", width: "1em", height: "1em", color: P.indigo }} /> : null}
          </div>
        );
      })}
      <Tap t={t} at={tapAt} x="40%" y="3.2em" />
    </div>
  );
}

function PinStep({ t, from, whoLabel }: { t: number; from: number; whoLabel: string }) {
  const tr = useTranslations("qrScene");
  const dots = [0, 1, 2, 3].filter((index) => t >= from + 0.15 + index * 0.13).length;
  const ok = progress(t, from + 0.7, 0.25);
  return (
    <>
      <WhoRow label={whoLabel} value={DEMO.cook.name} />
      <div style={{ fontSize: "0.95em", fontWeight: 700, margin: "0.6em 0.1em 0.4em" }}>{tr('ui.pinLabel')}</div>
      <div
        style={{
          height: "2.5em",
          borderRadius: "0.8em",
          border: `0.1em solid ${ok > 0 ? P.ok : P.indigo}`,
          background: P.card,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5em",
          fontSize: "1.2em",
          letterSpacing: "0.1em",
          boxShadow: `0 0 0 0.25em ${ok > 0 ? "rgba(22,163,74,0.14)" : "rgba(85,102,246,0.14)"}`,
        }}
      >
        {[0, 1, 2, 3].map((index) => (
          <span key={index} style={{ width: "0.5em", height: "0.5em", borderRadius: "999px", background: index < dots ? P.ink : P.lineStrong }} />
        ))}
      </div>
      <p style={{ margin: "0.5em 0.1em 0.7em", fontSize: "0.66em", color: P.ink2 }}>{tr('ui.pinHint')}</p>
      <PrimaryButton pressed={press(t, from + 0.62)}>{tr('ui.pinContinue')}</PrimaryButton>
      {ok > 0 ? (
        <div style={fade(ok, { position: "absolute", left: 0, right: 0, top: "38%" })}>
          <DrawnCheck t={t} at={from + 0.7} size="3.6em" />
        </div>
      ) : null}
    </>
  );
}

function Done({ t, at, title, children, tone = "ok" }: { t: number; at: number; title: string; children?: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div style={{ borderRadius: "1.2em", background: P.card, border: `0.06em solid ${P.line}`, padding: "1.3em 0.8em 1em", textAlign: "center", marginTop: "0.4em" }}>
      {tone === "ok" ? (
        <DrawnCheck t={t} at={at} />
      ) : (
        <div style={{ width: "4.4em", height: "4.4em", margin: "0 auto", borderRadius: "999px", background: P.badTint, color: P.bad, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <AlertTriangle style={{ width: "2.2em", height: "2.2em" }} />
        </div>
      )}
      <div style={{ fontSize: "1.1em", fontWeight: 700, marginTop: "0.55em", letterSpacing: "-0.01em", color: tone === "bad" ? P.badInk : P.ink }}>{title}</div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Бумажный бланк: штамп «СИСТЕМА ХАССП» и таблица, как в PDF.
 * ------------------------------------------------------------------- */

const cell: CSSProperties = {
  border: `0.08em solid ${P.rule}`,
  padding: "0.28em 0.35em",
  textAlign: "center",
  verticalAlign: "middle",
  lineHeight: 1.2,
};
const headCell: CSSProperties = { ...cell, background: P.paperHead, fontWeight: 700 };

function Paper({ stampLabel, title, subtitle, caption, children, startedDay }: { stampLabel: string; title: string; subtitle?: string; caption?: string; children: ReactNode; startedDay: SceneDay }) {
  const tr = useTranslations("qrScene");
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const startedDate = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(startedDay.year, startedDay.month - 1, 1)));
  // Лист «лежит на столе» и поднимается навстречу камере, пока она
  // спускается к журналу.
  const { pan } = useContext(CameraContext);
  const tilt = (1 - pan) * 16;
  return (
    <div
      className={`absolute overflow-hidden ${POS.paper}`}
      style={{
        background: P.paper,
        color: P.paperInk,
        borderRadius: "0.5em",
        boxShadow: "0 2.2em 4em -1.4em rgba(0,0,0,0.7), 0 0 0 0.06em rgba(255,255,255,0.4)",
        transform: tilt > 0.01 ? `perspective(110em) rotateX(${tilt.toFixed(2)}deg)` : undefined,
        transformOrigin: "50% 0%",
      }}
    >
      <div style={{ padding: "1em 1.1em", fontFamily: "inherit" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "0.82em" }}>
          <colgroup>
            <col style={{ width: "26%" }} />
            <col />
            <col style={{ width: "22%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td rowSpan={2} style={{ ...cell, fontWeight: 700 }}>{DEMO.org}</td>
              <td style={cell}>{tr('pdf.stamp')}</td>
              <td style={{ ...cell, textAlign: "left", whiteSpace: "nowrap" }}>{tr("documentStartedOn", { date: startedDate })}</td>
            </tr>
            <tr>
              <td style={{ ...cell, fontStyle: "italic", fontSize: "0.9em" }}>{stampLabel.toUpperCase()}</td>
              <td style={cell}>{tr("pageIndicator")}</td>
            </tr>
          </tbody>
        </table>
        {caption ? <div className="hidden md:block" style={{ textAlign: "right", fontSize: "0.72em", marginTop: "0.6em", color: "#4a4a52" }}>{caption}</div> : null}
        {subtitle ? <div className="hidden md:block" style={{ textAlign: "center", fontWeight: 700, marginTop: "0.7em", fontSize: "0.9em" }}>{subtitle}</div> : null}
        <div aria-hidden="true" className="h-[0.7em] md:hidden" />
        <div className="hidden md:block" style={{ textAlign: "center", fontWeight: 700, margin: subtitle ? "0.2em 0 0.7em" : "0.8em 0 0.7em", fontSize: "0.92em", letterSpacing: "0.01em" }}>{title}</div>
        {children}
      </div>
      {/* Фактура бумаги: еле заметное зерно. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: NOISE, opacity: 0.07, mixBlendMode: "multiply", pointerEvents: "none" }} />
      {/* Правый край бланка уходит «за кадр» — лист шире сцены. */}
      <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "3em", background: `linear-gradient(90deg, rgba(255,253,248,0), ${P.paper})` }} />
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "2em", background: `linear-gradient(180deg, rgba(255,253,248,0), ${P.paper})` }} />
    </div>
  );
}

/** Пустые строки под ручное заполнение — бланк годится и для бумаги, как в PDF. */
function EmptyRows({ count, columns }: { count: number; columns: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, row) => (
        <tr key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} style={{ ...cell, height: "1.9em" }} />
          ))}
        </tr>
      ))}
    </>
  );
}

/** Значение ложится в графу: проявляется, ячейка подсвечена и гаснет. */
function Ink({ t, at, children, tone = "ink", style }: { t: number; at: number; children: ReactNode; tone?: "ink" | "bad"; style?: CSSProperties }) {
  const p = progress(t, at, 0.35, ease.out);
  const glow = 1 - progress(t, at + 0.35, 0.9, ease.inOut);
  const active = t >= at;
  return (
    <td
      style={{
        ...cell,
        background: active ? (tone === "bad" ? `rgba(210,69,61,${0.1 + glow * 0.14})` : `rgba(85,102,246,${glow * 0.2})`) : undefined,
        color: tone === "bad" ? P.badInk : P.paperInk,
        fontWeight: tone === "bad" ? 700 : 600,
        ...style,
      }}
    >
      <span style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * -0.5}em)` }}>{active ? children : null}</span>
    </td>
  );
}

/** Окно дней в журнале холодильников: сегодня и соседние дни. */
function dayWindow(day: SceneDay) {
  const total = Math.min(12, day.daysInMonth);
  const start = Math.min(Math.max(1, day.day - 8), day.daysInMonth - total + 1);
  const days = Array.from({ length: total }, (_, index) => start + index);
  // На телефоне видно 5 дней: сегодня — четвёртым, если месяц позволяет.
  const mobileStart = Math.min(Math.max(start, day.day - 3), start + total - 5);
  return { days, mobileCount: 5, isMobileVisible: (d: number) => d >= mobileStart && d < mobileStart + 5 };
}

/** Прежние дни: правдоподобные показания, как у живого журнала. */
function pastValue(seed: number, d: number, base: number, spread: number): number {
  const x = Math.sin(seed * 97.13 + d * 12.9898) * 43758.5453;
  return Math.round((base + (x - Math.floor(x)) * spread) * 10) / 10;
}

type ColdRow = { name: string; norm: string; seed: number; base: number; spread: number; today?: { at: number; value: string; bad: boolean } | null; todayMissing?: boolean };

function ColdSheet({ t, day, rows, codeAt, missingPulse }: { t: number; day: SceneDay; rows: ColdRow[]; codeAt: number | null; missingPulse?: number }) {
  const tr = useTranslations("qrScene");
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const { days, isMobileVisible, mobileCount } = dayWindow(day);
  const hideOnMobile = (d: number) => (isMobileVisible(d) ? "" : "hidden md:table-cell");
  // Ячейки на всю ширину — в двух вариантах: на телефоне видно меньше дней,
  // а число колонок фиксированной таблицы задаёт первая строка.
  const spanRow = (content: ReactNode, style: CSSProperties, extra = 0) => (
    <>
      <th colSpan={mobileCount + extra} className="md:hidden" style={style}>
        {content}
      </th>
      <th colSpan={days.length + extra} className="hidden md:table-cell" style={style}>
        {content}
      </th>
    </>
  );
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "0.8em" }}>
      <colgroup>
        <col style={{ width: "9.4em" }} />
        <col style={{ width: "8.2em" }} />
      </colgroup>
      <thead>
        <tr>
          <th colSpan={2} rowSpan={2} style={headCell}>{tr('pdf.coldName')}</th>
          {spanRow(tr("monthLabel", { month: day.monthLabel }), headCell)}
        </tr>
        <tr>
          {days.map((d) => (
            <th key={d} className={hideOnMobile(d)} style={{ ...headCell, fontWeight: d === day.day ? 800 : 600, background: d === day.day ? P.highlight : P.paperHead, padding: "0.2em 0" }}>
              {d}
              <span style={{ display: "block", fontSize: "0.78em", fontWeight: 500 }}>{weekday(day, d, locale).toUpperCase()}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>{spanRow(tr('pdf.coldTemp'), { ...cell, fontWeight: 700 }, 2)}</tr>
        {rows.map((row) => (
          <tr key={row.name}>
            <td colSpan={2} style={{ ...cell, textAlign: "left" }}>
              {row.name}
              <span style={{ color: "#55555e" }}>{"  "}{row.norm}</span>
            </td>
            {days.map((d) => {
              if (d < day.day) {
                return (
                  <td key={d} className={hideOnMobile(d)} style={{ ...cell, padding: "0.28em 0" }}>
                    {pdfNumber(pastValue(row.seed, d, row.base, row.spread), locale)}
                  </td>
                );
              }
              if (d === day.day && row.today) {
                return (
                  <Ink key={d} t={t} at={row.today.at} tone={row.today.bad ? "bad" : "ink"} style={{ padding: "0.28em 0" }}>
                    {row.today.value}
                  </Ink>
                );
              }
              if (d === day.day && row.todayMissing) {
                const pulse = missingPulse ?? 0;
                return (
                  <td key={d} style={{ ...cell, background: `rgba(210,69,61,${0.06 + pulse * 0.16})`, outline: `0.14em dashed rgba(210,69,61,${0.45 + pulse * 0.5})`, outlineOffset: "-0.2em", color: P.badInk, fontWeight: 700 }}>
                    ?
                  </td>
                );
              }
              return <td key={d} className={hideOnMobile(d)} style={{ ...cell, background: d === day.day ? "rgba(85,102,246,0.06)" : undefined }} />;
            })}
          </tr>
        ))}
        <tr>
          <td style={{ ...cell, fontSize: "0.86em" }}>{tr('pdf.coldResponsible')}</td>
          <td style={{ ...cell, textAlign: "left", fontSize: "0.86em" }}>
            {"С1 - "}{DEMO.cook.short}
            <br />
            {"С2 - Петров О."}</td>
          {days.map((d) => {
            if (d < day.day) {
              return (
                <td key={d} className={hideOnMobile(d)} style={{ ...cell, padding: "0.28em 0" }}>
                  {d % 3 === 0 ? "С2" : "С1"}
                </td>
              );
            }
            if (d === day.day && codeAt !== null) {
              return (
                <Ink key={d} t={t} at={codeAt} style={{ padding: "0.28em 0" }}>
                  {"С1"}</Ink>
              );
            }
            return <td key={d} className={hideOnMobile(d)} style={cell} />;
          })}
        </tr>
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------------------
 * Уведомление (Telegram / почта) и дорожка шагов
 * ------------------------------------------------------------------- */

function Toast({ t, at, channel, title, lines, tone = "bad", mail = false }: { t: number; at: number; channel: string; title: string; lines: string[]; tone?: "bad" | "info"; mail?: boolean }) {
  if (t < at) return null;
  const p = progress(t, at, 0.4, ease.outBack);
  const accent = tone === "bad" ? P.bad : P.indigo;
  return (
    <div
      className={`absolute ${POS.toast}`}
      style={{
        zIndex: 20,
        opacity: Math.min(1, p * 1.4),
        transform: `translateY(${(1 - p) * -1.2}em) scale(${0.94 + p * 0.06})`,
        transformOrigin: "top right",
        background: P.card,
        color: P.ink,
        borderRadius: "1em",
        padding: "0.7em 0.8em 0.75em",
        boxShadow: "0 1.4em 3em -1em rgba(0,0,0,0.6), 0 0 0 0.06em rgba(255,255,255,0.3)",
        borderLeft: `0.28em solid ${accent}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.4em", fontSize: "0.78em", color: P.muted, fontWeight: 600 }}>
        <span style={{ display: "inline-flex", width: "1.6em", height: "1.6em", alignItems: "center", justifyContent: "center", borderRadius: "999px", background: "#229ed9", color: "#fff" }}>
          <Send style={{ width: "0.85em", height: "0.85em" }} />
        </span>
        {mail ? (
          <span style={{ display: "inline-flex", width: "1.6em", height: "1.6em", alignItems: "center", justifyContent: "center", borderRadius: "999px", background: P.indigoTint, color: P.indigoDeep }}>
            <Mail style={{ width: "0.85em", height: "0.85em" }} />
          </span>
        ) : null}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{channel}</span>
      </div>
      <div style={{ marginTop: "0.4em", fontWeight: 700, lineHeight: 1.25 }}>{title}</div>
      {lines.map((line) => (
        <div key={line} style={{ fontSize: "0.86em", color: P.ink2, lineHeight: 1.35 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

type RailStep = { label: string; at: number; value?: ReactNode };

/**
 * Шаги сценария — вертикальная дорожка справа от телефона. Пройденный шаг
 * показывает, что в нём записано (кто, PIN, значение, время): запись
 * собирается на глазах, а потом уезжает в журнал.
 */
function Rail({ t, steps }: { t: number; steps: RailStep[] }) {
  const { push } = useContext(CameraContext);
  const active = steps.reduce((acc, step, index) => (t >= step.at ? index : acc), -1);
  const pulse = (Math.sin(t * 5.5) + 1) / 2;
  return (
    <ol className={`absolute m-0 flex list-none flex-col p-0 ${POS.rail}`} style={{ color: "#ffffff", opacity: 1 - push * 0.85 }}>
      {steps.map((step, index) => {
        const done = index < active;
        const now = index === active;
        const last = index === steps.length - 1;
        const next = steps[index + 1];
        // Линия к следующему шагу заполняется, пока идёт текущий.
        const fill = done ? 1 : now && next ? progress(t, step.at, Math.max(0.2, next.at - step.at), ease.linear) : 0;
        const valueAt = next ? next.at : step.at + 0.35;
        const valueIn = step.value !== undefined && t >= valueAt ? progress(t, valueAt, 0.3) : 0;
        return (
          <li
            key={step.label}
            className="relative flex min-w-0 gap-[0.65em]"
            style={{ paddingBottom: last ? 0 : "0.95em", opacity: now ? 1 : done ? 0.9 : 0.42 }}
          >
            {last ? null : (
              <span
                aria-hidden="true"
                style={{ position: "absolute", left: "0.75em", top: "1.8em", bottom: "0.2em", width: "0.1em", borderRadius: "999px", background: "rgba(255,255,255,0.16)", overflow: "hidden" }}
              >
                <span style={{ display: "block", width: "100%", height: `${(fill * 100).toFixed(1)}%`, background: "linear-gradient(180deg,#7cf5c0,#8b97ff)" }} />
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                width: "1.6em",
                height: "1.6em",
                flex: "none",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "999px",
                fontWeight: 700,
                background: done ? "#7cf5c0" : now ? P.indigo : "rgba(255,255,255,0.1)",
                color: done ? "#0b3a26" : "#ffffff",
                boxShadow: now ? `0 0 0 ${(0.2 + pulse * 0.16).toFixed(3)}em rgba(85,102,246,${(0.38 - pulse * 0.14).toFixed(3)})` : undefined,
              }}
            >
              {done ? <Check style={{ width: "0.95em", height: "0.95em" }} strokeWidth={3} /> : <span style={{ fontSize: "0.82em" }}>{index + 1}</span>}
            </span>
            <span className="min-w-0" style={{ paddingTop: "0.14em" }}>
              <span style={{ display: "block", fontWeight: now ? 700 : 500, lineHeight: 1.25 }}>{step.label}</span>
              {valueIn > 0 ? (
                <span
                  style={{
                    display: "block",
                    marginTop: "0.18em",
                    fontSize: "0.86em",
                    fontWeight: 600,
                    lineHeight: 1.25,
                    color: "#7cf5c0",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    opacity: valueIn,
                    transform: `translateY(${((1 - valueIn) * 0.3).toFixed(3)}em)`,
                  }}
                >
                  {step.value}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------------
 * Перелёт значения из телефона в журнал
 * ------------------------------------------------------------------- */

const FLIGHT_SECONDS = 0.85;

/**
 * Значение уходит из телефона в журнал: капсула летит по дуге, за ней
 * тянется след, в графе расходится волна и появляется метка «когда и кто».
 * Камера в это время спускается к бланку — капсула ведёт взгляд.
 */
function Flight({ t, at, path, children, tone = "ok", meta }: { t: number; at: number; path: FlightPath; children: ReactNode; tone?: "ok" | "bad"; meta?: string }) {
  if (t < at) return null;
  return (
    <>
      <div className="md:hidden">
        <FlightLeg t={t} at={at} leg={path.mobile} tone={tone} meta={meta} size="3cqw" id="m">
          {children}
        </FlightLeg>
      </div>
      <div className="hidden md:block">
        <FlightLeg t={t} at={at} leg={path.desktop} tone={tone} meta={meta} size="1.25cqw" id="d">
          {children}
        </FlightLeg>
      </div>
    </>
  );
}

function FlightLeg({ t, at, leg, children, tone, meta, size, id }: { t: number; at: number; leg: Leg; children: ReactNode; tone: "ok" | "bad"; meta?: string; size: string; id: string }) {
  const raw = Math.min(1, Math.max(0, (t - at) / FLIGHT_SECONDS));
  const s = ease.inOut(raw);
  const { from, to } = leg;
  // Дуга «подбрасывания»: вправо и чуть вверх, потом вниз в графу.
  const c = { x: to.x * 0.8 + from.x * 0.2, y: from.y - 8 };
  const bez = (a: number, ctrl: number, b: number) => (1 - s) * (1 - s) * a + 2 * (1 - s) * s * ctrl + s * s * b;
  const x = bez(from.x, c.x, to.x);
  const y = bez(from.y, c.y, to.y);
  // След — «хвост кометы»: последний отрезок кривой за капсулой.
  const tailFrom = Math.max(0, s - 0.38);
  const tail = Array.from({ length: 13 }, (_, step) => {
    const k = tailFrom + ((s - tailFrom) * step) / 12;
    const point = (a: number, ctrl: number, b: number) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * ctrl + k * k * b;
    return `${point(from.x, c.x, to.x).toFixed(3)} ${point(from.y, c.y, to.y).toFixed(3)}`;
  });
  const landAt = at + FLIGHT_SECONDS * 0.92;
  const trail = 1 - progress(t, landAt, 0.3, ease.inOut);
  const scale = raw < 0.18 ? 0.55 + (raw / 0.18) * 0.6 : 1.15 - ((raw - 0.18) / 0.82) * 0.5;
  const alpha = raw < 0.1 ? raw / 0.1 : raw > 0.8 ? Math.max(0, 1 - (raw - 0.8) / 0.2) : 1;
  const ring = progress(t, landAt, 0.55, ease.out);
  const tag = windowed(t, landAt + 0.05, landAt + 1.8, 0.2);
  const bright = tone === "bad" ? "#ff8f86" : "#7cf5c0";
  const deep = tone === "bad" ? "#d2453d" : "#5566f6";
  const gradientId = `qr-flight-${id}`;
  return (
    <div style={{ fontSize: size }}>
      {trail > 0 ? (
        <svg
          aria-hidden="true"
          viewBox={`0 0 100 ${WORLD_H * 100}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: 29 }}
        >
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={tail[0].split(" ")[0]} y1={tail[0].split(" ")[1]} x2={x.toFixed(3)} y2={y.toFixed(3)}>
              <stop offset="0" stopColor={deep} stopOpacity="0" />
              <stop offset="1" stopColor={bright} />
            </linearGradient>
          </defs>
          {[
            { width: 10, opacity: 0.18 },
            { width: 3.5, opacity: 1 },
          ].map((stroke) => (
            <path
              key={stroke.width}
              d={`M ${tail.join(" L ")}`}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={trail * stroke.opacity}
            />
          ))}
        </svg>
      ) : null}
      {alpha > 0 && raw < 1 ? (
        <div
          style={{
            position: "absolute",
            left: `${x.toFixed(3)}%`,
            top: worldY(y),
            zIndex: 30,
            transform: `translate(-50%, -50%) scale(${scale.toFixed(4)})`,
            opacity: alpha,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4em",
            whiteSpace: "nowrap",
            padding: "0.42em 0.85em",
            borderRadius: "999px",
            color: "#ffffff",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            background: tone === "bad" ? "linear-gradient(135deg,#f43f5e,#d2453d)" : "linear-gradient(135deg,#5566f6,#7a5cff)",
            boxShadow: `0 0.7em 1.8em -0.5em ${tone === "bad" ? "rgba(210,69,61,0.85)" : "rgba(85,102,246,0.9)"}, inset 0 0 0 0.07em rgba(255,255,255,0.35)`,
          }}
        >
          {children}
        </div>
      ) : null}
      {t >= landAt && ring < 1 ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${to.x}%`,
            top: worldY(to.y),
            zIndex: 28,
            width: "3em",
            height: "3em",
            marginLeft: "-1.5em",
            marginTop: "-1.5em",
            borderRadius: "999px",
            border: `0.14em solid ${bright}`,
            transform: `scale(${(0.3 + ring * 1.6).toFixed(4)})`,
            opacity: 1 - ring,
          }}
        />
      ) : null}
      {meta && tag > 0 ? (
        <div
          style={{
            position: "absolute",
            left: `${to.x}%`,
            top: worldY(to.y),
            zIndex: 31,
            transform:
              leg.tag === "right"
                ? `translate(${(2.5 + (1 - tag) * 0.35).toFixed(3)}em, -50%)`
                : `translate(-50%, ${(1.15 + (1 - tag) * 0.35).toFixed(3)}em)`,
            opacity: tag,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35em",
            whiteSpace: "nowrap",
            padding: "0.32em 0.7em",
            borderRadius: "999px",
            background: "#0b1024",
            color: "#ffffff",
            fontSize: "0.8em",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 0.6em 1.4em -0.6em rgba(0,0,0,0.6)",
          }}
        >
          <Check style={{ width: "1em", height: "1em", color: bright }} strokeWidth={3} />
          {meta}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Фото настоящего места — «смена помещения» между главами. Фото темнее
 * переднего плана, чтобы в фокусе были телефон и бланк. Пока камера идёт
 * к журналу, фон уходит вверх медленнее переднего плана (параллакс) и
 * темнеет до «стола», на котором лежит бланк. Всё — функция t.
 */
function Backdrop({ chapter, t, pan, push }: { chapter: Chapter; t: number; pan: number; push: number }) {
  const enter = progress(t, 0, 0.45, ease.out);
  const drift = progress(t, 0, CHAPTER_SECONDS, ease.linear);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: P.stage }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={chapter.photo}
        alt=""
        style={{
          position: "absolute",
          left: 0,
          top: "-6%",
          width: "100%",
          height: "124%",
          objectFit: "cover",
          opacity: 0.88 * (0.55 + 0.45 * enter),
          filter: "saturate(0.86) brightness(0.62) contrast(1.06)",
          transform: `translateY(${(-pan * 14).toFixed(3)}%) scale(${((1.1 - 0.05 * drift) * (1 + 0.08 * push)).toFixed(4)}) translateX(${((1 - enter) * 2.2).toFixed(3)}%)`,
          willChange: "transform",
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(110% 80% at 0% 0%, ${chapter.accent}3d, transparent 55%)` }} />
      {/* Подложка под шаги: справа от телефона на десктопе, справа колонкой на телефоне. */}
      <div className="md:hidden" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(8,11,26,0.25) 0%, rgba(8,11,26,0.4) 50%, rgba(8,11,26,0.72) 100%)" }} />
      <div className="hidden md:block" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(8,11,26,0.2) 0%, rgba(8,11,26,0.66) 33%, rgba(8,11,26,0.5) 63%, rgba(8,11,26,0.12) 100%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,11,26,0) 45%, rgba(8,11,26,0.7) 100%)" }} />
      {/* «Стол» под журналом проступает, пока камера спускается. */}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${P.stage}cc, ${P.stage})`, opacity: pan * 0.78 }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.45 + pan * 0.35,
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
          backgroundSize: "22px 22px",
          backgroundPosition: `0 ${(-pan * 36).toFixed(1)}px`,
        }}
      />
    </div>
  );
}

/**
 * Плёнка поверх кадра: виньетка и зерно, своё на каждый кадр. Зерно —
 * один слой шире кадра, который каждый кадр сдвигается transform'ом:
 * это работа компоновщика, без перерисовки.
 */
function FilmFinish({ frame }: { frame: number }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(125% 95% at 50% 42%, rgba(4,6,14,0) 58%, rgba(4,6,14,0.5) 100%)" }} />
      <div
        style={{
          position: "absolute",
          inset: "-180px",
          backgroundImage: NOISE,
          opacity: 0.05,
          transform: `translate(${Math.floor(hash(frame) * 180) - 90}px, ${Math.floor(hash(frame + 7) * 180) - 90}px)`,
          willChange: "transform",
        }}
      />
    </div>
  );
}

function Place({ chapter }: { chapter: Chapter }) {
  const tr = useTranslations("qrScene");
  const Icon = { fridge: Refrigerator, locker: Thermometer, uv: Lightbulb, fryer: CookingPot, forgot: BellRing, sensor: Wifi }[chapter.id];
  const placeKey = {
    fridge: "chapters.fridgePlace",
    locker: "chapters.lockerPlace",
    uv: "chapters.uvPlace",
    fryer: "chapters.fryerPlace",
    forgot: "chapters.forgotPlace",
    sensor: "chapters.sensorPlace",
  } as const satisfies Record<Chapter["id"], string>;
  return (
    <div className={`absolute flex items-center gap-[0.5em] ${POS.place}`} style={{ color: "#ffffff" }}>
      <span style={{ display: "inline-flex", width: "1.8em", height: "1.8em", flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "0.6em", background: "rgba(124,245,192,0.14)", color: "#7cf5c0" }}>
        <Icon style={{ width: "1.05em", height: "1.05em" }} />
      </span>
      <span className="min-w-0 truncate" style={{ fontWeight: 600 }}>
        {tr(placeKey[chapter.id])}
      </span>
      <MapPin className="hidden md:block" style={{ width: "0.95em", height: "0.95em", opacity: 0.45, flex: "none" }} />
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Главы
 * ------------------------------------------------------------------- */

/** Ключевые моменты глав: когда сохраняют и когда камера идёт к журналу. */
const MOMENT = {
  fridgeSave: (bad: boolean) => (bad ? 4.35 : 4.1),
  lockerSign: 4.0,
  uvOn: 2.55,
  uvOff: 4.35,
  fryerSave: 4.15,
  forgotJournal: 4.3,
  sensorJournal: 3.3,
} as const;

type Layer = "world" | "screen";

const SCAN_STEPS = (scan: string, who: string, pin: string, value: string, save: string, values: { who?: ReactNode; value?: ReactNode; save?: ReactNode } = {}): RailStep[] => [
  { label: scan, at: 0, value: <QrCode style={{ width: "1em", height: "1em" }} /> },
  { label: who, at: 1.0, value: values.who },
  { label: pin, at: 1.9, value: "• • • •" },
  { label: value, at: 2.8, value: values.value },
  { label: save, at: 4.2, value: values.save },
];

/**
 * Точки перелёта (в координатах мира): старт — экран телефона, финиш —
 * графа «сегодня» в бланке. Графа холодильников зависит от числа месяца —
 * считаем столбец так же, как `ColdSheet`.
 */
function coldTodayX(day: SceneDay, layout: "mobile" | "desktop"): number {
  const { days, isMobileVisible } = dayWindow(day);
  if (layout === "desktop") {
    const index = Math.max(0, days.indexOf(day.day));
    // Лист 3.5…96.5 % ширины; колонки названий — 17.6em при 0.8 от 1.36cqw.
    const inner = 93 - 2 * 1.1 * 1.36;
    const names = 17.6 * 0.8 * 1.36;
    return 3.5 + 1.1 * 1.36 + names + ((index + 0.5) * (inner - names)) / days.length;
  }
  const visible = days.filter(isMobileVisible);
  const index = Math.max(0, visible.indexOf(day.day));
  const inner = 92 - 2 * 1.1 * 3.1;
  const names = 17.6 * 0.8 * 3.1;
  return 4 + 1.1 * 3.1 + names + ((index + 0.5) * (inner - names)) / visible.length;
}

/** Строка бланка холодильников: y центра n-й строки оборудования (0 — первая). */
function coldRowY(row: number, layout: "mobile" | "desktop"): number {
  return layout === "desktop" ? 129 + row * 4.1 : 133 + row * 8.6;
}

/** Откуда вылетает значение: кнопка «Сохранить» на экране телефона. */
const PHONE_OUT = { mobile: { x: 30, y: 46 }, desktop: { x: 18.5, y: 43 } } as const;

function FridgeScene({ t, value, today, qr, photo, layer }: { t: number; value: number; today: SceneDay; qr: QrMatrix; photo: string; layer: Layer }) {
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const bad = fridgeOutOfRange(value);
  const shown = String(Math.round(value * 10) / 10).replace("-", "−");
  const typedValue = typed(decimalLabel(value, locale), t, 3.0);
  const save = MOMENT.fridgeSave(bad);
  const landed = save + FLIGHT_SECONDS * 0.92;
  if (layer === "screen") {
    return bad ? (
      <Toast
        t={t}
        at={landed + 0.3}
        channel={tr("telegramResponsibleChannel")}
        title={tr('ui.deviationTitle')}
        lines={[`${tr("equipmentLabel")}: ${DEMO.fridge}`, `${tr("currentLabel")} ${shown}°C`, `${tr("normLabel")} ${tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max })}`]}
      />
    ) : null;
  }
  const valueLabel = `${decimalLabel(value, locale)} °C`;
  return (
    <>
      <Paper stampLabel={journal("cold_equipment_control")} title={journal("cold_equipment_control").toUpperCase()} startedDay={today}>
        <ColdSheet
          t={t}
          day={today}
          codeAt={landed + 0.15}
          rows={[
            { name: DEMO.fridge, norm: tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max }), seed: 1, base: 3.1, spread: 1.6, today: { at: landed, value: pdfNumber(value, locale), bad } },
            { name: "Морозильник №2", norm: tr("temperatureRange", { minimum: -18, maximum: -15 }), seed: 2, base: -17.6, spread: 1.4, today: null },
            { name: DEMO.vitrine, norm: tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max }), seed: 3, base: 3.4, spread: 1.4, today: null },
          ]}
        />
      </Paper>
      <PhoneFrame clock="08:41" ping={0.55}>
        <QrHeader title={journal("cold_equipment_control")} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.95}>
            <WhoRow label={tr('ui.equipment')} value={DEMO.fridge} />
            <EmployeeList t={t} tapAt={1.45} label={tr('ui.equipmentWho')} />
          </Screen>
          <Screen t={t} from={1.95} to={2.85}>
            <PinStep t={t} from={1.95} whoLabel={tr('ui.equipmentWho')} />
          </Screen>
          <Screen t={t} from={2.85} to={save + 0.25}>
            <WhoRow label={tr('ui.equipment')} value={DEMO.fridge} />
            <div style={{ borderRadius: "0.85em", border: `0.1em solid ${bad && typedValue ? P.bad : P.indigo}`, background: P.card, padding: "0.45em 0.7em" }}>
              <div style={{ fontSize: "0.66em", color: P.muted, fontWeight: 600 }}>{tr("temperatureLabelWithUnit")}</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.4em" }}>
                <span style={{ fontSize: "1.5em", fontWeight: 700, fontVariantNumeric: "tabular-nums", minHeight: "1.2em" }}>
                  {typedValue}
                  <span style={{ opacity: t < save && Math.floor(t * 3) % 2 === 0 ? 1 : 0, color: P.indigo }}>|</span>
                </span>
                {typedValue ? (
                  <span style={{ whiteSpace: "nowrap", fontSize: "0.62em", fontWeight: 700, padding: "0.25em 0.55em", borderRadius: "999px", background: bad ? P.badTint : P.okTint, color: bad ? P.badInk : P.okInk }}>
                    {tr("temperatureStatusRange", { status: bad ? tr("outsideNorm") : tr("norm"), minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max })}
                  </span>
                ) : null}
              </div>
            </div>
            {bad ? (
              <div style={fade(progress(t, 3.45, 0.3), { marginTop: "0.5em", borderRadius: "0.85em", border: `0.07em solid ${P.amberLine}`, background: P.amberTint, color: P.amberInk, padding: "0.5em 0.6em" })}>
                <div style={{ display: "flex", gap: "0.35em", alignItems: "center", fontSize: "0.74em", fontWeight: 700 }}>
                  <AlertTriangle style={{ width: "1em", height: "1em", flex: "none" }} />
                  {tr('ui.tempOut')}
                </div>
                <div style={{ fontSize: "0.64em", marginTop: "0.2em" }}>{tr('ui.managerWillKnow')}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3em", marginTop: "0.4em" }}>
                  {[{ id: "masterCalled", label: tr("ui.masterCalled") }, { id: "productsMoved", label: tr("ui.productsMoved") }].map((chip) => {
                    const on = chip.id === "productsMoved" && t >= 3.85;
                    return (
                      <span key={chip.id} style={{ fontSize: "0.6em", fontWeight: 600, padding: "0.3em 0.6em", borderRadius: "999px", background: on ? P.indigo : P.card, color: on ? "#fff" : P.ink2, border: `0.08em solid ${on ? P.indigo : P.amberLine}` }}>
                        {chip.label}
                      </span>
                    );
                  })}
                </div>
                <Tap t={t} at={3.8} x="72%" y="80%" />
              </div>
            ) : null}
            <PrimaryButton pressed={press(t, save)} style={{ marginTop: "0.6em" }}>
              {tr('ui.saveReading')}
            </PrimaryButton>
          </Screen>
          <Screen t={t} from={save + 0.25} to={7}>
            <Done t={t} at={save + 0.3} title={tr('ui.written')}>
              <p style={{ margin: "0.45em 0 0", fontSize: "0.7em", color: P.ink2 }}>
                {tr("readingSaved", { value, employee: DEMO.cook.name })}
              </p>
              {bad ? (
                <p style={{ margin: "0.55em 0 0", fontSize: "0.64em", padding: "0.5em", borderRadius: "0.7em", background: P.badTint, color: P.badInk, textAlign: "left" }}>{tr('ui.readingOutDone')}</p>
              ) : null}
            </Done>
          </Screen>
        </div>
        <Viewfinder t={t} object="fridge" qr={qr} bodyTemp={36.6} photo={photo} />
      </PhoneFrame>
      <Rail
        t={t}
        steps={SCAN_STEPS(tr("scanSticker"), tr("ui.whoFills"), "PIN", tr("temperatureLabel"), tr("ui.saveReading"), {
          who: DEMO.cook.short,
          value: valueLabel,
          save: "08:41",
        })}
      />
      <Flight
        t={t}
        at={save}
        tone={bad ? "bad" : "ok"}
        meta={`08:41 · ${DEMO.cook.short} · С1`}
        path={{
          mobile: { from: PHONE_OUT.mobile, to: { x: coldTodayX(today, "mobile"), y: coldRowY(0, "mobile") } },
          desktop: { from: PHONE_OUT.desktop, to: { x: coldTodayX(today, "desktop"), y: coldRowY(0, "desktop") }, tag: "right" },
        }}
      >
        {bad ? <AlertTriangle style={{ width: "1em", height: "1em" }} /> : <Check style={{ width: "1em", height: "1em" }} strokeWidth={3} />}
        {valueLabel}
      </Flight>
    </>
  );
}

function LockerScene({ t, bodyTemp, today, qr, photo, layer }: { t: number; bodyTemp: number; today: SceneDay; qr: QrMatrix; photo: string; layer: Layer }) {
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  const hygieneT = useTranslations("hygiene");
  const hygieneColumnsT = useTranslations("hygiene.columns");
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const fever = bodyFever(bodyTemp);
  const checkedKeys = HEALTH_CONFIRMATIONS.filter((item, index) => t >= 2.85 + index * 0.3 && !(fever && item.key === "temperature")).map((item) => item.key);
  // Решение — той же функцией, что и настоящий QR «Гигиена и здоровье».
  const decision = healthDecision(fever ? ["infection", "respiratorySkin"] : ["temperature", "infection", "respiratorySkin"]);
  const signAt = MOMENT.lockerSign;
  const landed = signAt + FLIGHT_SECONDS * 0.92;
  const mark = (ok: boolean) => (ok ? tr("yes") : tr("no"));
  const colWidths = ["2.2em", "5.6em", "7.6em", "5.2em", "5.6em", "5.6em", "5.6em", "5.6em", "8em"];
  const reasons = HEALTH_CONFIRMATIONS.filter((item) => !decision.confirmations[item.key]).map((item) => tr(HEALTH_MESSAGE_KEYS[item.key].complaint)).join(", ");
  if (layer === "screen") {
    return decision.admitted ? null : (
      <Toast
        t={t}
        at={landed + 0.35}
        channel={tr("telegramEmailSupervisor")}
        title={`${DEMO.cook.name} ${tr('ui.notAdmittedNotice')}`}
        lines={[tr("health.needsReview", { reasons })]}
        mail
      />
    );
  }
  const temperatureLabel = `${decimalLabel(bodyTemp, locale)} °C`;
  return (
    <>
      <Paper stampLabel={journal("hygiene")} title={journal("hygiene").toUpperCase()} caption={hygieneT("form.caption")} startedDay={today}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "50.9em", fontSize: "0.8em" }}>
          <colgroup>
            {colWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {HYGIENE_V2_COLUMNS.map((column) => (
                <th key={column.key} style={{ ...headCell, fontSize: "0.7em", fontWeight: 600, height: "5.4em" }}>
                  <span style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{column.key === "date" ? tr("pdf.uvDate") : hygieneColumnsT(HYGIENE_COLUMN_KEYS[column.key as keyof typeof HYGIENE_COLUMN_KEYS])}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>1</td>
              <td style={cell}>{dateLabel(today, locale)}</td>
              <td style={{ ...cell, textAlign: "left" }}>{DEMO.others[0].name}</td>
              <td style={{ ...cell, textAlign: "left" }}>{DEMO.others[0].position}</td>
              <td style={cell}>{tr("yes")}</td>
              <td style={cell}>{tr("yes")}</td>
              <td style={cell}>{tr("yes")}</td>
              <td style={cell}>{tr("ui.admitted")}</td>
              <td style={{ ...cell, fontSize: "0.82em" }}>Козлова Е., зав. производством · 08:10</td>
            </tr>
            <tr>
              <Ink t={t} at={landed}>2</Ink>
              <Ink t={t} at={landed}>{dateLabel(today, locale)}</Ink>
              <Ink t={t} at={landed + 0.05} style={{ textAlign: "left" }}>{DEMO.cook.name}</Ink>
              <Ink t={t} at={landed + 0.05} style={{ textAlign: "left" }}>{DEMO.cook.position}</Ink>
              <Ink t={t} at={landed + 0.15} tone={decision.confirmations.temperature ? "ink" : "bad"}>{mark(decision.confirmations.temperature)}</Ink>
              <Ink t={t} at={landed + 0.2}>{mark(decision.confirmations.infection)}</Ink>
              <Ink t={t} at={landed + 0.25}>{mark(decision.confirmations.respiratorySkin)}</Ink>
              {decision.admitted ? <Ink t={t} at={landed + 0.45}>{tr("ui.admitted")}</Ink> : <td style={cell} />}
              {decision.admitted ? (
                <Ink t={t} at={landed + 0.5} style={{ fontSize: "0.82em" }}>
                  Козлова Е., зав. производством · 08:53</Ink>
              ) : (
                <td style={cell} />
              )}
            </tr>
            <EmptyRows count={2} columns={9} />
          </tbody>
        </table>
        {t >= landed + 0.4 ? (
          <div
            style={fade(progress(t, landed + 0.4, 0.3), {
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4em",
              marginTop: "0.8em",
              padding: "0.35em 0.7em",
              borderRadius: "999px",
              fontSize: "0.8em",
              fontWeight: 700,
              background: decision.admitted ? P.okTint : P.badTint,
              color: decision.admitted ? P.okInk : P.badInk,
            })}
          >
            {decision.admitted ? <Check style={{ width: "1em", height: "1em" }} /> : <AlertTriangle style={{ width: "1em", height: "1em" }} />}
            {decision.admitted ? tr("health.signatureConfirmed") : tr("health.needsReview", { reasons })}
          </div>
        ) : null}
      </Paper>
      <PhoneFrame clock="08:52" ping={0.55}>
        <QrHeader title={tr("hygieneAndHealthJournals", { hygieneJournal: journal("hygiene") })} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.9}>
            <EmployeeList t={t} tapAt={1.4} label={tr('ui.whoFills')} />
          </Screen>
          <Screen t={t} from={1.9} to={2.75}>
            <PinStep t={t} from={1.9} whoLabel={tr('ui.whoFills')} />
          </Screen>
          <Screen t={t} from={2.75} to={signAt + 0.25}>
            <div style={{ fontSize: "0.95em", fontWeight: 700, margin: "0 0.1em 0.45em" }}>{tr('ui.sign')}</div>
            {HEALTH_CONFIRMATIONS.map((item) => {
              const on = checkedKeys.includes(item.key);
              return (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5em",
                    padding: "0.45em 0.55em",
                    marginBottom: "0.35em",
                    borderRadius: "0.8em",
                    border: `0.1em solid ${on ? P.ok : P.lineStrong}`,
                    background: on ? P.okTint : P.card,
                  }}
                >
                  <span style={{ display: "inline-flex", width: "1.3em", height: "1.3em", flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "0.3em", background: on ? P.ok : P.card, border: `0.1em solid ${on ? P.ok : P.lineStrong}`, color: "#fff" }}>
                    {on ? <Check style={{ width: "0.9em", height: "0.9em" }} strokeWidth={3} /> : null}
                  </span>
                  <span style={{ fontSize: "0.64em", fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{tr(HEALTH_MESSAGE_KEYS[item.key].confirmation)}</span>
                </div>
              );
            })}
            <PrimaryButton pressed={press(t, signAt)} style={{ marginTop: "0.5em" }}>
              {tr('ui.signButton')}
            </PrimaryButton>
          </Screen>
          <Screen t={t} from={signAt + 0.25} to={7}>
            {decision.admitted ? (
              <Done t={t} at={signAt + 0.3} title={tr('ui.admitted')}>
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>{tr("health.entrySaved", { journals: tr("hygieneAndHealthJournals", { hygieneJournal: journal("hygiene") }), employee: DEMO.cook.name, time: "08:52" })}</p>
              </Done>
            ) : (
              <Done t={t} at={signAt + 0.3} title={tr('ui.notAdmitted')} tone="bad">
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.badInk }}>
                  {tr("health.needsReview", { reasons })}</p>
              </Done>
            )}
          </Screen>
        </div>
        <Viewfinder t={t} object="thermometer" qr={qr} bodyTemp={bodyTemp} photo={photo} />
      </PhoneFrame>
      <Rail
        t={t}
        steps={SCAN_STEPS(tr("scanSticker"), tr("ui.whoFills"), "PIN", tr("threeSignatures"), tr("ui.signButton"), {
          who: DEMO.cook.short,
          value: `${checkedKeys.length}/${HEALTH_CONFIRMATIONS.length}`,
          save: "08:52",
        })}
      />
      <Flight
        t={t}
        at={signAt}
        tone={decision.admitted ? "ok" : "bad"}
        meta={`08:52 · ${decision.admitted ? tr("ui.admitted") : `${DEMO.cook.short} ${tr("ui.notAdmittedNotice")}`}`}
        path={{
          mobile: { from: PHONE_OUT.mobile, to: { x: 36, y: 131 } },
          desktop: { from: PHONE_OUT.desktop, to: { x: 17.6, y: 133.5 } },
        }}
      >
        {decision.admitted ? <Check style={{ width: "1em", height: "1em" }} strokeWidth={3} /> : <AlertTriangle style={{ width: "1em", height: "1em" }} />}
        {temperatureLabel}
      </Flight>
    </>
  );
}

function UvScene({ t, today, qr, photo, layer }: { t: number; today: SceneDay; qr: QrMatrix; photo: string; layer: Layer }) {
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  const hoursLabel = (value: number) => tr("ui.hoursValue", { value: Math.round(value) });
  const onAt = MOMENT.uvOn;
  const offAt = MOMENT.uvOff;
  const landed = offAt + FLIGHT_SECONDS * 0.92;
  if (layer === "screen") return null;
  const running = t >= onAt + 0.1 && t < offAt + 0.1;
  const used = DEMO.lampUsed + (t >= offAt + 0.1 ? 0.5 : 0);
  const remaining = DEMO.lampLifetime - used;
  const skip = windowed(t, 3.55, 4.05, 0.15);
  return (
    <>
      <Paper stampLabel={tr('pdf.uvStampLabel')} subtitle={DEMO.lamp.toUpperCase()} title={journal("uv_lamp_runtime")} startedDay={today}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "0.82em" }}>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "22%" }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              {[tr('pdf.uvDate'), tr('pdf.uvOn'), tr('pdf.uvOff'), tr('pdf.uvTotal'), tr('pdf.uvWho')].map((label) => (
                <th key={label} style={{ ...headCell, fontWeight: 600, fontSize: "0.86em" }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[2, 1].map((back) => {
              const d = Math.max(1, today.day - back);
              return (
                <tr key={back}>
                  <td style={cell}>{dateLabel(today, locale, d)}</td>
                  <td style={cell}>09:05</td>
                  <td style={cell}>09:35</td>
                  <td style={cell}>30</td>
                  <td style={{ ...cell, textAlign: "left" }}>{back === 2 ? "Петров Олег" : DEMO.cook.name}</td>
                </tr>
              );
            })}
            <tr>
              <Ink t={t} at={onAt + 0.35}>{dateLabel(today, locale)}</Ink>
              <Ink t={t} at={onAt + 0.35}>09:00</Ink>
              <Ink t={t} at={landed}>09:30</Ink>
              <Ink t={t} at={landed + 0.08}>30</Ink>
              <Ink t={t} at={onAt + 0.4} style={{ textAlign: "left" }}>
                {DEMO.cook.name}
              </Ink>
            </tr>
            <EmptyRows count={4} columns={5} />
          </tbody>
        </table>
        <div style={{ marginTop: "0.8em", fontSize: "0.8em", color: "#4a4a52" }}>
          {tr("lampUsage", { used: hoursLabel(used), total: hoursLabel(DEMO.lampLifetime) })}
        </div>
      </Paper>
      <PhoneFrame clock={t >= 4 ? "09:30" : "09:00"} ping={0.55}>
        <QrHeader title={journal("uv_lamp_runtime")} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.75}>
            <WhoRow label={tr("ui.lampLabel")} value={DEMO.lamp} />
            <EmployeeList t={t} tapAt={1.3} label={tr('ui.uvWho')} />
          </Screen>
          <Screen t={t} from={1.75} to={2.35}>
            <PinStep t={t} from={1.6} whoLabel={tr('ui.uvWho')} />
          </Screen>
          <Screen t={t} from={2.35} to={7}>
            <WhoRow label={tr("ui.lampLabel")} value={DEMO.lamp} />
            {t < onAt + 0.15 || (t >= 4.05 && t < offAt + 0.15) ? (
              <>
                {running ? (
                  <div style={{ borderRadius: "0.8em", border: `0.07em solid ${P.amberLine}`, background: P.amberTint, color: P.amberInk, padding: "0.45em 0.6em", fontSize: "0.72em", marginBottom: "0.5em" }}>
                    {tr("lampRunningSince", { time: "09:00", employee: DEMO.cook.name })}
                  </div>
                ) : null}
                <PrimaryButton pressed={press(t, running ? offAt : onAt)} color={running ? P.bad : P.ok} style={{ minHeight: "5.6em", flexDirection: "column", borderRadius: "1.1em", fontSize: "1em", boxShadow: "0 1em 2em -1em rgba(11,16,36,0.5)" }}>
                  {running ? <LightbulbOff style={{ width: "1.8em", height: "1.8em" }} /> : <Lightbulb style={{ width: "1.8em", height: "1.8em" }} />}
                  {running ? tr('ui.uvOff') : tr('ui.uvOn')}
                </PrimaryButton>
                <p style={{ textAlign: "center", fontSize: "0.66em", color: P.muted, margin: "0.6em 0 0" }}>
                  {tr("lampUsageRemaining", { used: hoursLabel(used), total: hoursLabel(DEMO.lampLifetime), remaining: hoursLabel(remaining) })}
                </p>
              </>
            ) : t < 4.05 ? (
              <Done t={t} at={onAt + 0.2} title={tr('ui.uvOnDone')}>
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>{tr("lampOffInstruction")}</p>
              </Done>
            ) : (
              <Done t={t} at={offAt + 0.2} title={tr('ui.uvOffDone')}>
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>
                  {tr("lampRuntimeSaved", { duration: tr("halfHour"), remainingLabel: tr("ui.uvRemaining"), remaining: hoursLabel(remaining) })}
                </p>
              </Done>
            )}
          </Screen>
        </div>
        {skip > 0 ? (
          <div style={fade(skip, { position: "absolute", inset: 0, zIndex: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(11,16,36,0.82)", color: "#fff", textAlign: "center", fontWeight: 700 })}>
            <span>
              <span style={{ display: "block", fontSize: "1.8em", fontVariantNumeric: "tabular-nums" }}>{tr("skipThirtyMinutes")}</span>
              <span style={{ display: "block", fontSize: "0.72em", fontWeight: 500, opacity: 0.8, marginTop: "0.3em" }}>{tr("rescanSameSticker")}</span>
            </span>
          </div>
        ) : null}
        <Viewfinder t={t} object="lamp" qr={qr} bodyTemp={36.6} photo={photo} />
      </PhoneFrame>
      <Rail
        t={t}
        steps={[
          { label: tr("scanSticker"), at: 0, value: <QrCode style={{ width: "1em", height: "1em" }} /> },
          { label: tr("whoSwitchesLamp"), at: 0.9, value: DEMO.cook.short },
          { label: "PIN", at: 1.75, value: "• • • •" },
          { label: tr("lampTurnedOn"), at: 2.35, value: "09:00" },
          { label: tr("lampTurnedOff"), at: 4.05, value: "09:30" },
        ]}
      />
      <Flight
        t={t}
        at={offAt}
        meta={`09:30 · ${DEMO.cook.short}`}
        path={{
          mobile: { from: PHONE_OUT.mobile, to: { x: 41.9, y: 133.5 } },
          desktop: { from: PHONE_OUT.desktop, to: { x: 41.5, y: 132.5 } },
        }}
      >
        <LightbulbOff style={{ width: "1em", height: "1em" }} />
        09:00 – 09:30
      </Flight>
    </>
  );
}

function FryerScene({ t, today, qr, photo, layer }: { t: number; today: SceneDay; qr: QrMatrix; photo: string; layer: Layer }) {
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  const save = MOMENT.fryerSave;
  const landed = save + FLIGHT_SECONDS * 0.92;
  if (layer === "screen") return null;
  const fields: Array<{ label: string; value: string; at: number }> = [
    { label: tr('fields.fat'), value: DEMO.fat, at: 2.9 },
    { label: tr('fields.equipment'), value: DEMO.fryer, at: 3.15 },
    { label: tr('fields.product'), value: DEMO.product, at: 3.4 },
    { label: tr('fields.qualityStart'), value: "5", at: 3.65 },
  ];
  const widths = ["7.4em", "7em", "7.2em", "6.6em", "6.4em", "6em", "7.2em", "5.6em", "5.6em", "8em"];
  return (
    <>
      <Paper stampLabel={journal("fryer_oil")} title={journal("fryer_oil").toUpperCase()} startedDay={today}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "67em", fontSize: "0.8em" }}>
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {[tr('pdf.fryerStart'), tr('pdf.fryerFat'), tr('pdf.fryerQualityStart'), tr('pdf.fryerEquipment'), tr('pdf.fryerProduct'), tr('pdf.fryerEnd'), tr('pdf.fryerQualityEnd')].map((label) => (
                <th key={label} rowSpan={2} style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>
                  {label}
                </th>
              ))}
              <th colSpan={2} style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>
                {tr('pdf.fryerLeftover')}
              </th>
              <th rowSpan={2} style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>
                {tr('pdf.fryerController')}
              </th>
            </tr>
            <tr>
              <th style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>{tr('pdf.fryerCarry')}</th>
              <th style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>{tr('pdf.fryerDisposed')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>{dateLabel(today, locale, Math.max(1, today.day - 1))} 10:20</td>
              <td style={cell}>{DEMO.fat}</td>
              <td style={cell}>{tr("qualityExcellent")}</td>
              <td style={cell}>{DEMO.fryer}</td>
              <td style={cell}>{DEMO.product}</td>
              <td style={cell}>21:40</td>
              <td style={cell}>{tr("qualityGood")}</td>
              <td style={cell}>2,5</td>
              <td style={cell}>-</td>
              <td style={cell}>Повар, Петров О.</td>
            </tr>
            <tr>
              <Ink t={t} at={landed}>{dateLabel(today, locale)}</Ink>
              <Ink t={t} at={landed + 0.05}>{DEMO.fat}</Ink>
              <Ink t={t} at={landed + 0.1}>{tr("qualityExcellent")}</Ink>
              <Ink t={t} at={landed + 0.15}>{DEMO.fryer}</Ink>
              <Ink t={t} at={landed + 0.2}>{DEMO.product}</Ink>
              <td style={cell} />
              <td style={cell} />
              <td style={cell}>-</td>
              <td style={cell}>-</td>
              <td style={cell} />
            </tr>
            <EmptyRows count={4} columns={10} />
          </tbody>
        </table>
      </Paper>
      <PhoneFrame clock="10:15" ping={0.55}>
        <QrHeader title={journal("fryer_oil")} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.85}>
            <EmployeeList t={t} tapAt={1.35} label={tr('ui.whoFills')} />
          </Screen>
          <Screen t={t} from={1.85} to={2.75}>
            <PinStep t={t} from={1.85} whoLabel={tr('ui.whoFills')} />
          </Screen>
          <Screen t={t} from={2.75} to={save + 0.25}>
            {fields.map((field) => (
              <div key={field.label} style={{ borderRadius: "0.75em", border: `0.07em solid ${t >= field.at ? P.lineStrong : P.line}`, background: P.card, padding: "0.35em 0.6em", marginBottom: "0.35em" }}>
                <div style={{ fontSize: "0.6em", color: P.muted, fontWeight: 600 }}>{field.label}</div>
                <div style={{ fontSize: "0.86em", fontWeight: 600, minHeight: "1.3em" }}>{typed(field.value, t, field.at, 0.03)}</div>
              </div>
            ))}
            <PrimaryButton pressed={press(t, save)} style={{ marginTop: "0.5em", fontSize: "0.82em" }}>
              {tr('ui.genericSubmit')}
            </PrimaryButton>
          </Screen>
          <Screen t={t} from={save + 0.25} to={7}>
            <Done t={t} at={save + 0.3} title={tr('ui.entrySaved')}>
              <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>{tr("fryer.entrySaved", { journal: journal("fryer_oil"), employee: DEMO.cook.name, time: "10:15" })}</p>
            </Done>
          </Screen>
        </div>
        <Viewfinder t={t} object="fryer" qr={qr} bodyTemp={36.6} photo={photo} />
      </PhoneFrame>
      <Rail t={t} steps={SCAN_STEPS(tr("scanSticker"), tr("ui.whoFills"), "PIN", tr("oilAndQuality"), tr("done"), { who: DEMO.cook.short, value: "5 / 5", save: "10:15" })} />
      <Flight
        t={t}
        at={save}
        meta={`10:15 · ${DEMO.product}`}
        path={{
          mobile: { from: PHONE_OUT.mobile, to: { x: 34.4, y: 134.7 } },
          desktop: { from: PHONE_OUT.desktop, to: { x: 16.9, y: 130.2 } },
        }}
      >
        <CookingPot style={{ width: "1em", height: "1em" }} />
        5 / 5
      </Flight>
    </>
  );
}

function ForgotScene({ t, today, layer }: { t: number; today: SceneDay; layer: Layer }) {
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  if (layer === "screen") return null;
  const stages = [
    { at: 0.6, time: "12:00", prefix: tr('ui.remindSoft'), mail: false },
    { at: 2.3, time: "17:00", prefix: tr('ui.remindWarn'), mail: true },
    { at: 4.0, time: "21:00", prefix: tr('ui.remindUrgent'), mail: true },
  ];
  const current = stages.reduce((acc, stage) => (t >= stage.at ? stage : acc), { at: 0, time: "11:40", prefix: "", mail: false });
  const pulse = (Math.sin(t * Math.PI * 2) + 1) / 2;
  return (
    <>
      <Paper stampLabel={journal("cold_equipment_control")} title={journal("cold_equipment_control").toUpperCase()} startedDay={today}>
        <ColdSheet
          t={t}
          day={today}
          codeAt={null}
          missingPulse={pulse}
          rows={[
            { name: DEMO.fridge, norm: tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max }), seed: 1, base: 3.1, spread: 1.6, todayMissing: true },
            { name: "Морозильник №2", norm: tr("temperatureRange", { minimum: -18, maximum: -15 }), seed: 2, base: -17.6, spread: 1.4, todayMissing: true },
          ]}
        />
      </Paper>
      <PhoneFrame clock={current.time}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55em", padding: "0.6em 0.8em", background: P.card, borderBottom: `0.06em solid ${P.line}` }}>
          <span style={{ display: "inline-flex", width: "2em", height: "2em", alignItems: "center", justifyContent: "center", borderRadius: "999px", background: "#0b1024", color: "#fff" }}>
            <QrCode style={{ width: "1em", height: "1em" }} />
          </span>
          <span>
            <span style={{ display: "block", fontSize: "0.86em", fontWeight: 700 }}>WeSetup</span>
            <span style={{ display: "block", fontSize: "0.62em", color: P.muted }}>{tr("botForManager")}</span>
          </span>
        </div>
        <div style={{ padding: "0.7em 0.6em", display: "flex", flexDirection: "column", gap: "0.5em", background: "#e7ebf3", height: "100%" }}>
          {stages.map((stage) => {
            if (t < stage.at) return null;
            const p = progress(t, stage.at, 0.35, ease.outBack);
            const urgent = stage.prefix === tr('ui.remindUrgent');
            return (
              <div key={stage.time} style={{ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 0.8}em)`, alignSelf: "flex-start", maxWidth: "94%", borderRadius: "0.9em 0.9em 0.9em 0.25em", background: P.card, padding: "0.45em 0.6em", boxShadow: "0 0.3em 0.8em -0.5em rgba(0,0,0,0.35)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.3em", fontSize: "0.7em", fontWeight: 700, color: urgent ? P.badInk : P.ink }}>
                  {urgent ? <AlertTriangle style={{ width: "1em", height: "1em", flex: "none" }} /> : <BellRing style={{ width: "1em", height: "1em", flex: "none" }} />}
                  {stage.prefix}: {tr('ui.remindBody')}
                </div>
                <div style={{ fontSize: "0.62em", color: P.ink2, marginTop: "0.25em", lineHeight: 1.3 }}>• {journal("cold_equipment_control")}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.25em", fontSize: "0.56em", color: P.muted }}>
                  <span>{tr(stage.mail ? "emailChannel" : "telegramOnlyChannel")}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{stage.time}</span>
                </div>
              </div>
            );
          })}
        </div>
      </PhoneFrame>
      <Rail
        t={t}
        steps={[
          { label: tr("reminderAtNoon"), at: 0.6 },
          { label: tr("reminderAtFive"), at: 2.3 },
          { label: tr("reminderAtNine"), at: 4.0 },
        ]}
      />
    </>
  );
}

function SensorScene({ t, today, layer }: { t: number; today: SceneDay; layer: Layer }) {
  const tr = useTranslations("qrScene");
  const journal = useTranslations("journals.names");
  const locale = FORMAT_LOCALES[useSiteLocale()];
  const readings = [
    { at: 0.5, time: "09:00", value: 3.8 },
    { at: 2.0, time: "10:00", value: 4.1 },
    { at: 3.5, time: "11:00", value: 7.2 },
  ];
  const current = readings.reduce((acc, reading) => (t >= reading.at ? reading : acc), readings[0]);
  const bad = fridgeOutOfRange(current.value);
  const beat = readings.some((reading) => t >= reading.at && t < reading.at + 0.5) ? 1 - progress(t, current.at, 0.5) : 0;
  const lastReading = readings[readings.length - 1];
  // Последний замер летит в журнал на глазах у камеры, прежние ложатся сразу.
  const inkAt = current === lastReading ? current.at + FLIGHT_SECONDS * 0.92 : current.at + 0.35;
  if (layer === "screen") {
    return bad ? (
      <Toast
        t={t}
        at={inkAt + 0.3}
        channel={tr("telegramResponsibleChannel")}
        title={tr("ui.deviationTitle")}
        lines={[`${tr("equipmentLabel")}: ${DEMO.vitrine}`, `${tr("currentLabel")} ${pdfNumber(current.value, locale)}°C`, `${tr("normLabel")} ${tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max })}`]}
      />
    ) : null;
  }
  return (
    <>
      <Paper stampLabel={journal("cold_equipment_control")} title={journal("cold_equipment_control").toUpperCase()} startedDay={today}>
        <ColdSheet
          t={t}
          day={today}
          codeAt={0}
          rows={[
            { name: DEMO.fridge, norm: tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max }), seed: 1, base: 3.1, spread: 1.6, today: { at: 0, value: "4", bad: false } },
            { name: DEMO.vitrine, norm: tr("temperatureRange", { minimum: FRIDGE_NORM.min, maximum: FRIDGE_NORM.max }), seed: 3, base: 3.4, spread: 1.4, today: { at: inkAt, value: pdfNumber(current.value, locale), bad } },
          ]}
        />
      </Paper>
      <div className={`absolute @container ${POS.phone}`}>
        <div style={{ fontSize: "5.3cqw", color: "#ffffff", paddingTop: "1.2em" }}>
          <div style={{ position: "relative", margin: "0 auto", width: "78%", aspectRatio: "1 / 1.05", borderRadius: "1.6em", background: "linear-gradient(160deg,#f7f8fc,#d9dcea)", boxShadow: "0 1.6em 3em -1em rgba(0,0,0,0.6)", padding: "1em", color: P.ink }}>
            <div style={{ borderRadius: "0.8em", background: bad ? "#ffe3df" : "#dfe9e3", padding: "0.8em 0.6em", textAlign: "center", boxShadow: "inset 0 0.15em 0.4em rgba(0,0,0,0.15)" }}>
              <div style={{ fontSize: "2.3em", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: bad ? P.badInk : "#1d3a2a", lineHeight: 1 }}>{decimalLabel(current.value, locale)}°</div>
              <div style={{ fontSize: "0.7em", marginTop: "0.3em", color: P.ink2, fontVariantNumeric: "tabular-nums" }}>{current.time}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35em", marginTop: "0.7em", fontSize: "0.72em", fontWeight: 600, color: P.ink2 }}>
              <Wifi style={{ width: "1.1em", height: "1.1em", color: P.indigo }} />
              {tr("wifiSensor")}</div>
            {beat > 0 ? (
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: "1.6em", boxShadow: `0 0 0 ${(1 - beat) * 1.2}em rgba(124,245,192,${beat * 0.45})` }} />
            ) : null}
          </div>
          <div style={{ textAlign: "center", marginTop: "1em", fontSize: "0.8em", fontWeight: 600 }}>{DEMO.vitrine}</div>
          <div style={{ textAlign: "center", marginTop: "0.3em", fontSize: "0.66em", color: "rgba(255,255,255,0.65)" }}>{tr("hourlyReadingWithoutPhone")}</div>
        </div>
      </div>
      <Rail
        t={t}
        steps={[
          { label: tr("sensorMeasures"), at: 0, value: `${decimalLabel(current.value, locale)} °C` },
          { label: tr("hourlyJournalLog"), at: 0.85, value: readings.filter((reading) => t >= reading.at).map((reading) => reading.time).join(" · ") },
          { label: tr("outOfRangeNotification"), at: 3.9, value: <Send style={{ width: "1em", height: "1em" }} /> },
        ]}
      />
      <Flight
        t={t}
        at={lastReading.at}
        tone={fridgeOutOfRange(lastReading.value) ? "bad" : "ok"}
        meta={`${lastReading.time} · ${tr("wifiSensor")}`}
        path={{
          mobile: { from: { x: 30, y: 30 }, to: { x: coldTodayX(today, "mobile"), y: coldRowY(1, "mobile") } },
          desktop: { from: { x: 18.5, y: 27 }, to: { x: coldTodayX(today, "desktop"), y: coldRowY(1, "desktop") }, tag: "right" },
        }}
      >
        <Wifi style={{ width: "1em", height: "1em" }} />
        {`${decimalLabel(lastReading.value, locale)} °C`}
      </Flight>
    </>
  );
}

/* ---------------------------------------------------------------------
 * Кадр целиком
 * ------------------------------------------------------------------- */

/** Когда камера уходит к журналу — момент сохранения в главе. */
function journalAtFor(chapter: Chapter, fridgeTemp: number): number {
  switch (chapter.id) {
    case "fridge":
      return MOMENT.fridgeSave(fridgeOutOfRange(fridgeTemp));
    case "locker":
      return MOMENT.lockerSign;
    case "uv":
      return MOMENT.uvOff;
    case "fryer":
      return MOMENT.fryerSave;
    case "forgot":
      return MOMENT.forgotJournal;
    case "sensor":
      return MOMENT.sensorJournal;
  }
}

/**
 * Кадр — камера над миром главы. Порядок движений:
 * 1) наезд: глава открывается крупным планом видоискателя и отъезжает к
 *    телефону (пружина, без перелёта);
 * 2) спуск: в момент сохранения камера опускается к журналу вслед за
 *    значением, бланк поднимается навстречу, фон уходит в глубину;
 * 3) дожим: медленный наезд на бланк до конца главы;
 * 4) склейка «на скорости»: в последние 0.2 с камера рывком уходит вверх,
 *    новая глава прилетает в движении (смаз) — у первой главы входа нет,
 *    её первый кадр — чистая обложка.
 * Плюс «ручная» камера: едва заметный дрейф. Всё — функция кадра.
 */
export function SceneFrame({ frame, fridgeTemp, bodyTemp, today, qr }: SceneProps) {
  const { chapter, index, local } = chapterAt(frame);
  const t = local / FPS;
  const journalAt = journalAtFor(chapter, fridgeTemp);
  const pan = spring(t, journalAt, 5.4);
  const push = 1 - spring(t, 0.1, 3.9);
  const settle = progress(t, journalAt + 0.8, CHAPTER_SECONDS - journalAt - 0.8, ease.inOut);
  const whipIn = index > 0 ? 1 - progress(t, 0, 0.3, ease.out) : 0;
  const tail = Math.max(0, (t - (CHAPTER_SECONDS - 0.2)) / 0.2);
  const whipOut = tail * tail;
  const whip = Math.max(whipIn, whipOut);
  const driftX = Math.sin(t * 0.7) * 0.22;
  const driftY = Math.cos(t * 0.55) * 0.1 + (whipOut - whipIn) * 4.5;
  const journalX = 50;
  const journalY = (PAN * 100 + 50) / WORLD_H;
  const zoom = 1 + 0.06 * settle;
  const transform = [
    `translate(${driftX.toFixed(3)}%, ${driftY.toFixed(3)}%)`,
    `translateY(${((-pan * PAN * 100) / WORLD_H).toFixed(3)}%)`,
    // Наезд «смотрит» на телефон: точка F уезжает в центр кадра и
    // увеличивается в z0 раз. Для точки мира p: T + z·p, T = (1 − z)·F + push·(C − F).
    `translate(calc((1 - var(--z0)) * ${push.toFixed(4)} * var(--fx) + ${push.toFixed(4)} * (50% - var(--fx))), calc((1 - var(--z0)) * ${push.toFixed(4)} * var(--fy) + ${push.toFixed(4)} * (${(50 / WORLD_H).toFixed(3)}% - var(--fy)))) scale(calc(1 + (var(--z0) - 1) * ${push.toFixed(4)}))`,
    `translate(${journalX}%, ${journalY.toFixed(3)}%) scale(${zoom.toFixed(4)}) translate(-${journalX}%, -${journalY.toFixed(3)}%)`,
  ].join(" ");
  const camera: CameraState = { t, frame, pan, push, journalAt };
  const scene = (layer: Layer) => (
    <>
      {chapter.id === "fridge" ? <FridgeScene t={t} value={fridgeTemp} today={today} qr={qr} photo={chapter.photo} layer={layer} /> : null}
      {chapter.id === "locker" ? <LockerScene t={t} bodyTemp={bodyTemp} today={today} qr={qr} photo={chapter.photo} layer={layer} /> : null}
      {chapter.id === "uv" ? <UvScene t={t} today={today} qr={qr} photo={chapter.photo} layer={layer} /> : null}
      {chapter.id === "fryer" ? <FryerScene t={t} today={today} qr={qr} photo={chapter.photo} layer={layer} /> : null}
      {chapter.id === "forgot" ? <ForgotScene t={t} today={today} layer={layer} /> : null}
      {chapter.id === "sensor" ? <SensorScene t={t} today={today} layer={layer} /> : null}
    </>
  );
  return (
    <CameraContext.Provider value={camera}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <Backdrop chapter={chapter} t={t} pan={pan} push={push} />
        <div
          className={`absolute left-0 top-0 w-full ${POS.camera}`}
          style={{
            height: `${WORLD_H * 100}%`,
            transformOrigin: "0 0",
            transform,
            opacity: 1 - whip * 0.3,
            filter: whip > 0.02 ? `blur(${(whip * 7).toFixed(2)}px)` : undefined,
          }}
        >
          {scene("world")}
        </div>
        {/* Подпись места видна, пока камера у телефона: на наезде и у
            журнала она только мешала бы. */}
        <div style={{ position: "absolute", inset: 0, opacity: (1 - whip) * (1 - push) ** 2 * Math.max(0, 1 - pan * 2.5) }}>
          <Place chapter={chapter} />
        </div>
        <div style={{ position: "absolute", inset: 0, opacity: 1 - whip }}>{scene("screen")}</div>
        <FilmFinish frame={frame} />
      </div>
    </CameraContext.Provider>
  );
}

export const STAGE_BACKGROUND = P.stage;

