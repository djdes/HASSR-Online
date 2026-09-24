import type { CSSProperties, ReactNode } from "react";
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

import { HEALTH_CONFIRMATIONS, healthDecision } from "@/lib/health-qr";
import { HYGIENE_V2_COLUMNS, HYGIENE_V2_FORM_CAPTION } from "@/lib/hygiene-v2";
import { formatDuration, formatHours } from "@/lib/uv-lamp";

import { ease, interpolate, progress, windowed } from "./clock";
import {
  CHAPTER_SECONDS,
  DEMO,
  FPS,
  FRIDGE_NORM,
  FRYER_FIELDS,
  JOURNALS,
  PDF,
  UI,
  bodyFever,
  chapterAt,
  formatDecimal,
  fridgeOutOfRange,
  type Chapter,
} from "./chapters";
import { QrSticker, type QrMatrix } from "./qr-sticker";

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
 * Раскладка кадра: 4:5 на телефоне, 16:9 от md.
 * ------------------------------------------------------------------- */

const POS = {
  place: "left-[4%] top-[3%] max-w-[92%] [font-size:3.1cqw] md:left-[34%] md:top-[4.6%] md:max-w-[62%] md:[font-size:1.2cqw]",
  paper: "left-[4%] right-[4%] top-[10%] h-[38.5%] [font-size:3.1cqw] md:left-[34%] md:right-[3.5%] md:top-[12%] md:h-[59%] md:[font-size:1.3cqw]",
  phone: "left-[4%] top-[51.5%] w-[50%] md:left-[5%] md:top-[6.5%] md:w-[24.5%]",
  rail: "left-[58%] right-[3%] top-[53%] [font-size:2.75cqw] md:left-[34%] md:right-[3.5%] md:top-[75.5%] md:[font-size:1.12cqw]",
  toast: "left-[55%] right-[2.5%] top-[74%] [font-size:2.5cqw] md:left-auto md:right-[2%] md:top-[7.5%] md:w-[31%] md:[font-size:1.02cqw]",
} as const;

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
function pdfNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function dateLabel(day: SceneDay, d = day.day): string {
  return `${String(d).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.${day.year}`;
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function weekday(day: SceneDay, d: number): string {
  return WEEKDAYS[new Date(Date.UTC(day.year, day.month - 1, d)).getUTCDay()];
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
        borderRadius: "999px",
        background: "#059669",
        boxShadow: "0 0 0 0.3em rgba(5,150,105,.14)",
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

function PhoneFrame({ clock, children }: { clock: string; children: ReactNode }) {
  return (
    <div className={`absolute @container ${POS.phone}`}>
      <div
        style={{
          fontSize: "5.3cqw",
          width: "100%",
          aspectRatio: "1 / 2",
          background: P.bezel,
          borderRadius: "2.4em",
          padding: "0.4em",
          boxShadow: "0 2.4em 4em -1.6em rgba(0,0,0,0.65), inset 0 0 0 0.08em rgba(255,255,255,0.14)",
        }}
      >
        <div
          style={{
            position: "relative",
            height: "100%",
            borderRadius: "2em",
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
            <span style={{ width: "4.6em", height: "1.2em", borderRadius: "999px", background: P.bezel }} />
            <span style={{ display: "inline-flex", gap: "0.3em", alignItems: "center" }}>
              <Wifi style={{ width: "1.05em", height: "1.05em" }} />
              <span style={{ width: "1.6em", height: "0.8em", borderRadius: "0.2em", border: "0.1em solid rgba(255,255,255,0.8)" }} />
            </span>
          </div>
          <div style={{ position: "absolute", inset: "1.9em 0 0 0", display: "flex", flexDirection: "column" }}>{children}</div>
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
function Viewfinder({ t, object, qr, bodyTemp, photo }: { t: number; object: ScanObject; qr: QrMatrix; bodyTemp: number; photo?: string }) {
  const hide = progress(t, 0.85, 0.25, ease.inOut);
  if (hide >= 1) return null;
  const lock = progress(t, 0.35, 0.3, ease.out);
  const found = progress(t, 0.55, 0.2, ease.out);
  const bracket = interpolate(lock, [0, 1], [1.35, 1]);
  const scan = (t * 1.6) % 1;
  return (
    <div style={fade(1 - hide, { position: "absolute", inset: 0, zIndex: 4, background: "#1a1f33", overflow: "hidden" })}>
      {photo ? (
        <>
          {/* Камера смотрит на настоящее место — фото вместо рисунка. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.85) saturate(0.95)" }}
          />
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 100% at 50% 42%, transparent 38%, rgba(8,11,24,0.6) 100%)" }} />
          {object === "thermometer" ? <ThermometerReadout bodyTemp={bodyTemp} /> : null}
        </>
      ) : (
        <ObjectArt object={object} bodyTemp={bodyTemp} />
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          width: "5.4em",
          transform: `translate(-50%, -50%) scale(${1 + found * 0.06})`,
        }}
      >
        <QrSticker qr={qr} caption={false} />
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
        wesetup.ru — открыть
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: "1.2em", textAlign: "center", fontSize: "0.66em", color: "rgba(255,255,255,0.75)" }}>
        Наведите камеру на наклейку
      </div>
    </div>
  );
}

/** Показание настенного термометра — поверх фото или рисунка раздевалки. */
function ThermometerReadout({ bodyTemp }: { bodyTemp: number }) {
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
      {formatDecimal(bodyTemp)} °C
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
  const dots = [0, 1, 2, 3].filter((index) => t >= from + 0.15 + index * 0.13).length;
  const ok = progress(t, from + 0.7, 0.25);
  return (
    <>
      <WhoRow label={whoLabel} value={DEMO.cook.name} />
      <div style={{ fontSize: "0.95em", fontWeight: 700, margin: "0.6em 0.1em 0.4em" }}>{UI.pinLabel}</div>
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
      <p style={{ margin: "0.5em 0.1em 0.7em", fontSize: "0.66em", color: P.ink2 }}>{UI.pinHint}</p>
      <PrimaryButton pressed={press(t, from + 0.62)}>{UI.pinContinue}</PrimaryButton>
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
  return (
    <div className={`absolute overflow-hidden ${POS.paper}`} style={{ background: P.paper, color: P.paperInk, borderRadius: "0.5em", boxShadow: "0 1.6em 3.2em -1.2em rgba(0,0,0,0.55), 0 0 0 0.06em rgba(255,255,255,0.4)" }}>
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
              <td style={cell}>{PDF.stamp}</td>
              <td style={{ ...cell, textAlign: "left", whiteSpace: "nowrap" }}>Начат 01-{String(startedDay.month).padStart(2, "0")}-{startedDay.year}</td>
            </tr>
            <tr>
              <td style={{ ...cell, fontStyle: "italic", fontSize: "0.9em" }}>{stampLabel.toUpperCase()}</td>
              <td style={cell}>СТР. 1 ИЗ 1</td>
            </tr>
          </tbody>
        </table>
        {caption ? <div className="hidden md:block" style={{ textAlign: "right", fontSize: "0.72em", marginTop: "0.6em", color: "#4a4a52" }}>{caption}</div> : null}
        {subtitle ? <div className="hidden md:block" style={{ textAlign: "center", fontWeight: 700, marginTop: "0.7em", fontSize: "0.9em" }}>{subtitle}</div> : null}
        <div aria-hidden="true" className="h-[0.7em] md:hidden" />
        <div className="hidden md:block" style={{ textAlign: "center", fontWeight: 700, margin: subtitle ? "0.2em 0 0.7em" : "0.8em 0 0.7em", fontSize: "0.92em", letterSpacing: "0.01em" }}>{title}</div>
        {children}
      </div>
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
          <th colSpan={2} rowSpan={2} style={headCell}>{PDF.coldName}</th>
          {spanRow(<>Месяц {day.monthLabel}</>, headCell)}
        </tr>
        <tr>
          {days.map((d) => (
            <th key={d} className={hideOnMobile(d)} style={{ ...headCell, fontWeight: d === day.day ? 800 : 600, background: d === day.day ? P.highlight : P.paperHead, padding: "0.2em 0" }}>
              {d}
              <span style={{ display: "block", fontSize: "0.78em", fontWeight: 500 }}>{weekday(day, d).toUpperCase()}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>{spanRow(PDF.coldTemp, { ...cell, fontWeight: 700 }, 2)}</tr>
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
                    {pdfNumber(pastValue(row.seed, d, row.base, row.spread))}
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
          <td style={{ ...cell, fontSize: "0.86em" }}>{PDF.coldResponsible}</td>
          <td style={{ ...cell, textAlign: "left", fontSize: "0.86em" }}>
            С1 - {DEMO.cook.short}
            <br />
            С2 - Петров О.
          </td>
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
                  С1
                </Ink>
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

type RailStep = { label: string; at: number };

function Rail({ t, steps }: { t: number; steps: RailStep[] }) {
  const active = steps.reduce((acc, step, index) => (t >= step.at ? index : acc), -1);
  return (
    <ol className={`absolute m-0 flex list-none flex-col gap-[0.5em] p-0 md:flex-row md:gap-[0.6em] ${POS.rail}`} style={{ color: "#ffffff" }}>
      {steps.map((step, index) => {
        const done = index < active;
        const now = index === active;
        return (
          <li key={step.label} className="flex min-w-0 items-center gap-[0.5em] md:flex-1 md:flex-col md:items-start md:gap-[0.45em]" style={{ opacity: now ? 1 : done ? 0.78 : 0.4 }}>
            <span className="hidden h-[0.22em] w-full rounded-full md:block" style={{ background: done || now ? "linear-gradient(90deg,#5566f6,#8b97ff)" : "rgba(255,255,255,0.16)" }} />
            <span className="flex min-w-0 items-center gap-[0.45em]">
              <span
                style={{
                  display: "inline-flex",
                  width: "1.55em",
                  height: "1.55em",
                  flex: "none",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "999px",
                  fontSize: "0.82em",
                  fontWeight: 700,
                  background: done ? "#7cf5c0" : now ? P.indigo : "rgba(255,255,255,0.1)",
                  color: done ? "#0b3a26" : "#ffffff",
                  boxShadow: now ? "0 0 0 0.3em rgba(85,102,246,0.3)" : undefined,
                }}
              >
                {done ? <Check style={{ width: "0.95em", height: "0.95em" }} strokeWidth={3} /> : index + 1}
              </span>
              <span style={{ fontWeight: now ? 700 : 500, lineHeight: 1.2 }}>{step.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Фото настоящего места — «смена помещения» между главами: свой кадр и
 * своя цветовая вуаль у каждой главы. Фото приглушено и затемнено книзу,
 * чтобы журнал, телефон и рельса шагов читались как раньше; точечная
 * сетка воспроизводится поверх — фактура ролика сохраняется. Всё —
 * функция t: перемотка детерминирована.
 */
function Backdrop({ chapter, t }: { chapter: Chapter; t: number }) {
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
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.64 * enter,
          filter: "saturate(0.78) brightness(0.7) contrast(1.06)",
          transform: `scale(${1.09 - 0.05 * drift}) translateX(${(1 - enter) * 2.2}%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${chapter.accent}38 0%, rgba(11,15,34,0.5) 46%, rgba(11,15,34,0.84) 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(110% 80% at 0% 0%, ${chapter.accent}40, transparent 55%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.55,
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
    </div>
  );
}

function Place({ chapter }: { chapter: Chapter }) {
  const Icon = { fridge: Refrigerator, locker: Thermometer, uv: Lightbulb, fryer: CookingPot, forgot: BellRing, sensor: Wifi }[chapter.id];
  return (
    <div className={`absolute flex items-center gap-[0.5em] ${POS.place}`} style={{ color: "#ffffff" }}>
      <span style={{ display: "inline-flex", width: "1.8em", height: "1.8em", flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "0.6em", background: "rgba(124,245,192,0.14)", color: "#7cf5c0" }}>
        <Icon style={{ width: "1.05em", height: "1.05em" }} />
      </span>
      <span className="min-w-0 truncate" style={{ fontWeight: 600 }}>
        {chapter.place}
      </span>
      <MapPin className="hidden md:block" style={{ width: "0.95em", height: "0.95em", opacity: 0.45, flex: "none" }} />
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Главы
 * ------------------------------------------------------------------- */

const SCAN_STEPS = (value: string, save: string): RailStep[] => [
  { label: "Скан наклейки", at: 0 },
  { label: "Кто заполняет", at: 1.0 },
  { label: "PIN", at: 1.9 },
  { label: value, at: 2.8 },
  { label: save, at: 4.2 },
];

function FridgeScene({ t, value, today, qr, photo }: { t: number; value: number; today: SceneDay; qr: QrMatrix; photo: string }) {
  const bad = fridgeOutOfRange(value);
  const shown = String(Math.round(value * 10) / 10).replace("-", "−");
  const typedValue = typed(formatDecimal(value), t, 3.0);
  const save = bad ? 4.35 : 4.1;
  return (
    <>
      <Paper stampLabel={JOURNALS.cold} title={JOURNALS.cold.toUpperCase()} startedDay={today}>
        <ColdSheet
          t={t}
          day={today}
          codeAt={save + 0.5}
          rows={[
            { name: DEMO.fridge, norm: `от ${FRIDGE_NORM.min}°C до ${FRIDGE_NORM.max}°C`, seed: 1, base: 3.1, spread: 1.6, today: { at: save + 0.4, value: pdfNumber(value), bad } },
            { name: "Морозильник №2", norm: "от -18°C до -15°C", seed: 2, base: -17.6, spread: 1.4, today: null },
            { name: DEMO.vitrine, norm: `от ${FRIDGE_NORM.min}°C до ${FRIDGE_NORM.max}°C`, seed: 3, base: 3.4, spread: 1.4, today: null },
          ]}
        />
      </Paper>
      <PhoneFrame clock="08:41">
        <QrHeader title={JOURNALS.cold} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.95}>
            <WhoRow label={UI.equipment} value={DEMO.fridge} />
            <EmployeeList t={t} tapAt={1.45} label={UI.equipmentWho} />
          </Screen>
          <Screen t={t} from={1.95} to={2.85}>
            <PinStep t={t} from={1.95} whoLabel={UI.equipmentWho} />
          </Screen>
          <Screen t={t} from={2.85} to={save + 0.25}>
            <WhoRow label={UI.equipment} value={DEMO.fridge} />
            <div style={{ borderRadius: "0.85em", border: `0.1em solid ${bad && typedValue ? P.bad : P.indigo}`, background: P.card, padding: "0.45em 0.7em" }}>
              <div style={{ fontSize: "0.66em", color: P.muted, fontWeight: 600 }}>Температура, °C</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.4em" }}>
                <span style={{ fontSize: "1.5em", fontWeight: 700, fontVariantNumeric: "tabular-nums", minHeight: "1.2em" }}>
                  {typedValue}
                  <span style={{ opacity: t < save && Math.floor(t * 3) % 2 === 0 ? 1 : 0, color: P.indigo }}>|</span>
                </span>
                {typedValue ? (
                  <span style={{ whiteSpace: "nowrap", fontSize: "0.62em", fontWeight: 700, padding: "0.25em 0.55em", borderRadius: "999px", background: bad ? P.badTint : P.okTint, color: bad ? P.badInk : P.okInk }}>
                    {bad ? "Вне нормы" : "Норма"} от {FRIDGE_NORM.min} до {FRIDGE_NORM.max}
                  </span>
                ) : null}
              </div>
            </div>
            {bad ? (
              <div style={fade(progress(t, 3.45, 0.3), { marginTop: "0.5em", borderRadius: "0.85em", border: `0.07em solid ${P.amberLine}`, background: P.amberTint, color: P.amberInk, padding: "0.5em 0.6em" })}>
                <div style={{ display: "flex", gap: "0.35em", alignItems: "center", fontSize: "0.74em", fontWeight: 700 }}>
                  <AlertTriangle style={{ width: "1em", height: "1em", flex: "none" }} />
                  {UI.tempOut}
                </div>
                <div style={{ fontSize: "0.64em", marginTop: "0.2em" }}>{UI.managerWillKnow}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3em", marginTop: "0.4em" }}>
                  {["Вызвал мастера", "Переложил продукты"].map((chip) => {
                    const on = chip === "Переложил продукты" && t >= 3.85;
                    return (
                      <span key={chip} style={{ fontSize: "0.6em", fontWeight: 600, padding: "0.3em 0.6em", borderRadius: "999px", background: on ? P.indigo : P.card, color: on ? "#fff" : P.ink2, border: `0.08em solid ${on ? P.indigo : P.amberLine}` }}>
                        {chip}
                      </span>
                    );
                  })}
                </div>
                <Tap t={t} at={3.8} x="72%" y="80%" />
              </div>
            ) : null}
            <PrimaryButton pressed={press(t, save)} style={{ marginTop: "0.6em" }}>
              {UI.saveReading}
            </PrimaryButton>
          </Screen>
          <Screen t={t} from={save + 0.25} to={7}>
            <Done t={t} at={save + 0.3} title={UI.written}>
              <p style={{ margin: "0.45em 0 0", fontSize: "0.7em", color: P.ink2 }}>
                Температура {shown}°C сохранена в журнал на имя {DEMO.cook.name}.
              </p>
              {bad ? (
                <p style={{ margin: "0.55em 0 0", fontSize: "0.64em", padding: "0.5em", borderRadius: "0.7em", background: P.badTint, color: P.badInk, textAlign: "left" }}>{UI.readingOutDone}</p>
              ) : null}
            </Done>
          </Screen>
        </div>
        <Viewfinder t={t} object="fridge" qr={qr} bodyTemp={36.6} photo={photo} />
      </PhoneFrame>
      <Rail t={t} steps={SCAN_STEPS("Температура", UI.saveReading)} />
      {bad ? (
        <Toast
          t={t}
          at={save + 0.75}
          channel="Telegram · ответственному"
          title={UI.deviationTitle}
          lines={[`Оборудование: ${DEMO.fridge}`, `Сейчас: ${shown}°C`, `Норма: от ${FRIDGE_NORM.min} до ${FRIDGE_NORM.max}°C`]}
        />
      ) : null}
    </>
  );
}

function LockerScene({ t, bodyTemp, today, qr, photo }: { t: number; bodyTemp: number; today: SceneDay; qr: QrMatrix; photo: string }) {
  const fever = bodyFever(bodyTemp);
  const checkedKeys = HEALTH_CONFIRMATIONS.filter((item, index) => t >= 2.85 + index * 0.3 && !(fever && item.key === "temperature")).map((item) => item.key);
  // Решение — той же функцией, что и настоящий QR «Гигиена и здоровье».
  const decision = healthDecision(fever ? ["infection", "respiratorySkin"] : ["temperature", "infection", "respiratorySkin"]);
  const signAt = 4.0;
  const mark = (ok: boolean) => (ok ? "да" : "нет");
  const colWidths = ["2.2em", "5.6em", "7.6em", "5.2em", "5.6em", "5.6em", "5.6em", "5.6em", "8em"];
  return (
    <>
      <Paper stampLabel={JOURNALS.hygiene} title={JOURNALS.hygiene.toUpperCase()} caption={HYGIENE_V2_FORM_CAPTION} startedDay={today}>
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
                  <span style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{column.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>1</td>
              <td style={cell}>{dateLabel(today)}</td>
              <td style={{ ...cell, textAlign: "left" }}>{DEMO.others[0].name}</td>
              <td style={{ ...cell, textAlign: "left" }}>{DEMO.others[0].position}</td>
              <td style={cell}>да</td>
              <td style={cell}>да</td>
              <td style={cell}>да</td>
              <td style={cell}>допущен</td>
              <td style={{ ...cell, fontSize: "0.82em" }}>Козлова Е., зав. производством · 08:10</td>
            </tr>
            <tr>
              <Ink t={t} at={signAt + 0.45}>2</Ink>
              <Ink t={t} at={signAt + 0.45}>{dateLabel(today)}</Ink>
              <Ink t={t} at={signAt + 0.5} style={{ textAlign: "left" }}>{DEMO.cook.name}</Ink>
              <Ink t={t} at={signAt + 0.5} style={{ textAlign: "left" }}>{DEMO.cook.position}</Ink>
              <Ink t={t} at={signAt + 0.6} tone={decision.confirmations.temperature ? "ink" : "bad"}>{mark(decision.confirmations.temperature)}</Ink>
              <Ink t={t} at={signAt + 0.65}>{mark(decision.confirmations.infection)}</Ink>
              <Ink t={t} at={signAt + 0.7}>{mark(decision.confirmations.respiratorySkin)}</Ink>
              {decision.admitted ? <Ink t={t} at={5.25}>допущен</Ink> : <td style={cell} />}
              {decision.admitted ? (
                <Ink t={t} at={5.3} style={{ fontSize: "0.82em" }}>
                  Козлова Е., зав. производством · 08:53
                </Ink>
              ) : (
                <td style={cell} />
              )}
            </tr>
            <EmptyRows count={2} columns={9} />
          </tbody>
        </table>
        {t >= signAt + 0.8 ? (
          <div
            style={fade(progress(t, signAt + 0.8, 0.3), {
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
            {decision.admitted ? "Журнал здоровья: подпись «+»" : `Статус дня: Отстранён · журнал здоровья: «${decision.health.measures}»`}
          </div>
        ) : null}
      </Paper>
      <PhoneFrame clock="08:52">
        <QrHeader title={`${JOURNALS.hygiene} и журнал здоровья`} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.9}>
            <EmployeeList t={t} tapAt={1.4} label={UI.whoFills} />
          </Screen>
          <Screen t={t} from={1.9} to={2.75}>
            <PinStep t={t} from={1.9} whoLabel={UI.whoFills} />
          </Screen>
          <Screen t={t} from={2.75} to={signAt + 0.25}>
            <div style={{ fontSize: "0.95em", fontWeight: 700, margin: "0 0.1em 0.45em" }}>{UI.sign}</div>
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
                  <span style={{ fontSize: "0.64em", fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.label}</span>
                </div>
              );
            })}
            <PrimaryButton pressed={press(t, signAt)} style={{ marginTop: "0.5em" }}>
              {UI.signButton}
            </PrimaryButton>
          </Screen>
          <Screen t={t} from={signAt + 0.25} to={7}>
            {decision.admitted ? (
              <Done t={t} at={signAt + 0.3} title={UI.admitted}>
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>Сохранено: гигиенический журнал и журнал здоровья · {DEMO.cook.name} · 08:52</p>
              </Done>
            ) : (
              <Done t={t} at={signAt + 0.3} title={UI.notAdmitted} tone="bad">
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.badInk }}>
                  Причина: {decision.complaints.join(", ")}. {UI.headKnows} — дождитесь его решения.
                </p>
              </Done>
            )}
          </Screen>
        </div>
        <Viewfinder t={t} object="thermometer" qr={qr} bodyTemp={bodyTemp} photo={photo} />
      </PhoneFrame>
      <Rail t={t} steps={SCAN_STEPS("Три подписи", UI.signButton)} />
      {decision.admitted ? null : (
        <Toast
          t={t}
          at={signAt + 0.9}
          channel="Telegram и почта · заведующей"
          title={`${DEMO.cook.name} ${UI.notAdmittedNotice}`}
          lines={[`Причина: ${decision.complaints.join(", ")} (отметка через QR в 08:52).`]}
          mail
        />
      )}
    </>
  );
}

function UvScene({ t, today, qr, photo }: { t: number; today: SceneDay; qr: QrMatrix; photo: string }) {
  const onAt = 2.55;
  const offAt = 4.35;
  const running = t >= onAt + 0.1 && t < offAt + 0.1;
  const used = DEMO.lampUsed + (t >= offAt + 0.1 ? 0.5 : 0);
  const remaining = DEMO.lampLifetime - used;
  const skip = windowed(t, 3.55, 4.05, 0.15);
  return (
    <>
      <Paper stampLabel={PDF.uvStampLabel} subtitle={DEMO.lamp.toUpperCase()} title={JOURNALS.uv} startedDay={today}>
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
              {[PDF.uvDate, PDF.uvOn, PDF.uvOff, PDF.uvTotal, PDF.uvWho].map((label) => (
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
                  <td style={cell}>{dateLabel(today, d)}</td>
                  <td style={cell}>09:05</td>
                  <td style={cell}>09:35</td>
                  <td style={cell}>30</td>
                  <td style={{ ...cell, textAlign: "left" }}>{back === 2 ? "Петров Олег" : DEMO.cook.name}</td>
                </tr>
              );
            })}
            <tr>
              <Ink t={t} at={onAt + 0.35}>{dateLabel(today)}</Ink>
              <Ink t={t} at={onAt + 0.35}>09:00</Ink>
              <Ink t={t} at={offAt + 0.4}>09:30</Ink>
              <Ink t={t} at={offAt + 0.45}>30</Ink>
              <Ink t={t} at={onAt + 0.4} style={{ textAlign: "left" }}>
                {DEMO.cook.name}
              </Ink>
            </tr>
            <EmptyRows count={4} columns={5} />
          </tbody>
        </table>
        <div style={{ marginTop: "0.8em", fontSize: "0.8em", color: "#4a4a52" }}>
          Наработка {formatHours(used)} из {formatHours(DEMO.lampLifetime)}
        </div>
      </Paper>
      <PhoneFrame clock={t >= 4 ? "09:30" : "09:00"}>
        <QrHeader title="Журнал учёта работы УФ-лампы" />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.75}>
            <WhoRow label="Лампа" value={DEMO.lamp} />
            <EmployeeList t={t} tapAt={1.3} label={UI.uvWho} />
          </Screen>
          <Screen t={t} from={1.75} to={2.35}>
            <PinStep t={t} from={1.6} whoLabel={UI.uvWho} />
          </Screen>
          <Screen t={t} from={2.35} to={7}>
            <WhoRow label="Лампа" value={DEMO.lamp} />
            {t < onAt + 0.15 || (t >= 4.05 && t < offAt + 0.15) ? (
              <>
                {running ? (
                  <div style={{ borderRadius: "0.8em", border: `0.07em solid ${P.amberLine}`, background: P.amberTint, color: P.amberInk, padding: "0.45em 0.6em", fontSize: "0.72em", marginBottom: "0.5em" }}>
                    Работает с <b>09:00</b> · включил(а) {DEMO.cook.name}
                  </div>
                ) : null}
                <PrimaryButton pressed={press(t, running ? offAt : onAt)} color={running ? P.bad : P.ok} style={{ minHeight: "5.6em", flexDirection: "column", borderRadius: "1.1em", fontSize: "1em", boxShadow: "0 1em 2em -1em rgba(11,16,36,0.5)" }}>
                  {running ? <LightbulbOff style={{ width: "1.8em", height: "1.8em" }} /> : <Lightbulb style={{ width: "1.8em", height: "1.8em" }} />}
                  {running ? UI.uvOff : UI.uvOn}
                </PrimaryButton>
                <p style={{ textAlign: "center", fontSize: "0.66em", color: P.muted, margin: "0.6em 0 0" }}>
                  Наработка {formatHours(used)} из {formatHours(DEMO.lampLifetime)} · осталось {formatHours(remaining)}
                </p>
              </>
            ) : t < 4.05 ? (
              <Done t={t} at={onAt + 0.2} title={UI.uvOnDone}>
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>Отметка в 09:00. Когда выключите — отсканируйте эту же наклейку и нажмите «Я выключил».</p>
              </Done>
            ) : (
              <Done t={t} at={offAt + 0.2} title={UI.uvOffDone}>
                <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>
                  Работал {formatDuration(0.5)} — записано в журнал. {UI.uvRemaining}: {formatHours(remaining)}.
                </p>
              </Done>
            )}
          </Screen>
        </div>
        {skip > 0 ? (
          <div style={fade(skip, { position: "absolute", inset: 0, zIndex: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(11,16,36,0.82)", color: "#fff", textAlign: "center", fontWeight: 700 })}>
            <span>
              <span style={{ display: "block", fontSize: "1.8em", fontVariantNumeric: "tabular-nums" }}>+30 мин</span>
              <span style={{ display: "block", fontSize: "0.72em", fontWeight: 500, opacity: 0.8, marginTop: "0.3em" }}>снова скан той же наклейки</span>
            </span>
          </div>
        ) : null}
        <Viewfinder t={t} object="lamp" qr={qr} bodyTemp={36.6} photo={photo} />
      </PhoneFrame>
      <Rail
        t={t}
        steps={[
          { label: "Скан наклейки", at: 0 },
          { label: "Кто включает", at: 0.9 },
          { label: "PIN", at: 1.75 },
          { label: "Я включил", at: 2.35 },
          { label: "Я выключил", at: 4.05 },
        ]}
      />
    </>
  );
}

function FryerScene({ t, today, qr, photo }: { t: number; today: SceneDay; qr: QrMatrix; photo: string }) {
  const save = 4.15;
  const fields: Array<{ label: string; value: string; at: number }> = [
    { label: FRYER_FIELDS.fat, value: DEMO.fat, at: 2.9 },
    { label: FRYER_FIELDS.equipment, value: DEMO.fryer, at: 3.15 },
    { label: FRYER_FIELDS.product, value: DEMO.product, at: 3.4 },
    { label: FRYER_FIELDS.qualityStart, value: "5", at: 3.65 },
  ];
  const widths = ["7.4em", "7em", "7.2em", "6.6em", "6.4em", "6em", "7.2em", "5.6em", "5.6em", "8em"];
  return (
    <>
      <Paper stampLabel={JOURNALS.fryer} title={JOURNALS.fryer.toUpperCase()} startedDay={today}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "67em", fontSize: "0.8em" }}>
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {[PDF.fryerStart, PDF.fryerFat, PDF.fryerQualityStart, PDF.fryerEquipment, PDF.fryerProduct, PDF.fryerEnd, PDF.fryerQualityEnd].map((label) => (
                <th key={label} rowSpan={2} style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>
                  {label}
                </th>
              ))}
              <th colSpan={2} style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>
                {PDF.fryerLeftover}
              </th>
              <th rowSpan={2} style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>
                {PDF.fryerController}
              </th>
            </tr>
            <tr>
              <th style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>{PDF.fryerCarry}</th>
              <th style={{ ...headCell, fontSize: "0.72em", fontWeight: 600 }}>{PDF.fryerDisposed}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>{dateLabel(today, Math.max(1, today.day - 1))} 10:20</td>
              <td style={cell}>{DEMO.fat}</td>
              <td style={cell}>Отличное</td>
              <td style={cell}>{DEMO.fryer}</td>
              <td style={cell}>{DEMO.product}</td>
              <td style={cell}>21:40</td>
              <td style={cell}>Хорошее</td>
              <td style={cell}>2,5</td>
              <td style={cell}>-</td>
              <td style={cell}>Повар, Петров О.</td>
            </tr>
            <tr>
              <Ink t={t} at={save + 0.4}>{dateLabel(today)}</Ink>
              <Ink t={t} at={save + 0.45}>{DEMO.fat}</Ink>
              <Ink t={t} at={save + 0.5}>Отличное</Ink>
              <Ink t={t} at={save + 0.55}>{DEMO.fryer}</Ink>
              <Ink t={t} at={save + 0.6}>{DEMO.product}</Ink>
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
      <PhoneFrame clock="10:15">
        <QrHeader title={JOURNALS.fryer} />
        <div style={{ position: "relative", flex: 1 }}>
          <Screen t={t} from={0.9} to={1.85}>
            <EmployeeList t={t} tapAt={1.35} label={UI.whoFills} />
          </Screen>
          <Screen t={t} from={1.85} to={2.75}>
            <PinStep t={t} from={1.85} whoLabel={UI.whoFills} />
          </Screen>
          <Screen t={t} from={2.75} to={save + 0.25}>
            {fields.map((field) => (
              <div key={field.label} style={{ borderRadius: "0.75em", border: `0.07em solid ${t >= field.at ? P.lineStrong : P.line}`, background: P.card, padding: "0.35em 0.6em", marginBottom: "0.35em" }}>
                <div style={{ fontSize: "0.6em", color: P.muted, fontWeight: 600 }}>{field.label}</div>
                <div style={{ fontSize: "0.86em", fontWeight: 600, minHeight: "1.3em" }}>{typed(field.value, t, field.at, 0.03)}</div>
              </div>
            ))}
            <PrimaryButton pressed={press(t, save)} style={{ marginTop: "0.5em", fontSize: "0.82em" }}>
              {UI.genericSubmit}
            </PrimaryButton>
          </Screen>
          <Screen t={t} from={save + 0.25} to={7}>
            <Done t={t} at={save + 0.3} title={UI.entrySaved}>
              <p style={{ margin: "0.45em 0 0", fontSize: "0.68em", color: P.ink2 }}>Сохранено: журнал учета использования фритюрных жиров · {DEMO.cook.name} · 10:15</p>
            </Done>
          </Screen>
        </div>
        <Viewfinder t={t} object="fryer" qr={qr} bodyTemp={36.6} photo={photo} />
      </PhoneFrame>
      <Rail t={t} steps={SCAN_STEPS("Жир и оценка", "Готово")} />
    </>
  );
}

function ForgotScene({ t, today }: { t: number; today: SceneDay }) {
  const stages = [
    { at: 0.6, time: "12:00", prefix: UI.remindSoft, mail: false },
    { at: 2.3, time: "17:00", prefix: UI.remindWarn, mail: true },
    { at: 4.0, time: "21:00", prefix: UI.remindUrgent, mail: true },
  ];
  const current = stages.reduce((acc, stage) => (t >= stage.at ? stage : acc), { at: 0, time: "11:40", prefix: "", mail: false });
  const pulse = (Math.sin(t * Math.PI * 2) + 1) / 2;
  return (
    <>
      <Paper stampLabel={JOURNALS.cold} title={JOURNALS.cold.toUpperCase()} startedDay={today}>
        <ColdSheet
          t={t}
          day={today}
          codeAt={null}
          missingPulse={pulse}
          rows={[
            { name: DEMO.fridge, norm: `от ${FRIDGE_NORM.min}°C до ${FRIDGE_NORM.max}°C`, seed: 1, base: 3.1, spread: 1.6, todayMissing: true },
            { name: "Морозильник №2", norm: "от -18°C до -15°C", seed: 2, base: -17.6, spread: 1.4, todayMissing: true },
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
            <span style={{ display: "block", fontSize: "0.62em", color: P.muted }}>бот · руководителю</span>
          </span>
        </div>
        <div style={{ padding: "0.7em 0.6em", display: "flex", flexDirection: "column", gap: "0.5em", background: "#e7ebf3", height: "100%" }}>
          {stages.map((stage) => {
            if (t < stage.at) return null;
            const p = progress(t, stage.at, 0.35, ease.outBack);
            const urgent = stage.prefix === UI.remindUrgent;
            return (
              <div key={stage.time} style={{ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 0.8}em)`, alignSelf: "flex-start", maxWidth: "94%", borderRadius: "0.9em 0.9em 0.9em 0.25em", background: P.card, padding: "0.45em 0.6em", boxShadow: "0 0.3em 0.8em -0.5em rgba(0,0,0,0.35)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.3em", fontSize: "0.7em", fontWeight: 700, color: urgent ? P.badInk : P.ink }}>
                  {urgent ? <AlertTriangle style={{ width: "1em", height: "1em", flex: "none" }} /> : <BellRing style={{ width: "1em", height: "1em", flex: "none" }} />}
                  {stage.prefix}: {UI.remindBody}
                </div>
                <div style={{ fontSize: "0.62em", color: P.ink2, marginTop: "0.25em", lineHeight: 1.3 }}>• {JOURNALS.cold}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.25em", fontSize: "0.56em", color: P.muted }}>
                  <span>{stage.mail ? "и письмо на почту" : "только Telegram"}</span>
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
          { label: "12:00 · Напоминание", at: 0.6 },
          { label: "17:00 · Внимание + почта", at: 2.3 },
          { label: "21:00 · СРОЧНО", at: 4.0 },
        ]}
      />
    </>
  );
}

function SensorScene({ t, today }: { t: number; today: SceneDay }) {
  const readings = [
    { at: 0.5, time: "09:00", value: 3.8 },
    { at: 2.0, time: "10:00", value: 4.1 },
    { at: 3.5, time: "11:00", value: 7.2 },
  ];
  const current = readings.reduce((acc, reading) => (t >= reading.at ? reading : acc), readings[0]);
  const bad = fridgeOutOfRange(current.value);
  const beat = readings.some((reading) => t >= reading.at && t < reading.at + 0.5) ? 1 - progress(t, current.at, 0.5) : 0;
  return (
    <>
      <Paper stampLabel={JOURNALS.cold} title={JOURNALS.cold.toUpperCase()} startedDay={today}>
        <ColdSheet
          t={t}
          day={today}
          codeAt={0}
          rows={[
            { name: DEMO.fridge, norm: `от ${FRIDGE_NORM.min}°C до ${FRIDGE_NORM.max}°C`, seed: 1, base: 3.1, spread: 1.6, today: { at: 0, value: "4", bad: false } },
            { name: DEMO.vitrine, norm: `от ${FRIDGE_NORM.min}°C до ${FRIDGE_NORM.max}°C`, seed: 3, base: 3.4, spread: 1.4, today: { at: current.at + 0.35, value: pdfNumber(current.value), bad } },
          ]}
        />
      </Paper>
      <div className={`absolute @container ${POS.phone}`}>
        <div style={{ fontSize: "5.3cqw", color: "#ffffff", paddingTop: "1.2em" }}>
          <div style={{ position: "relative", margin: "0 auto", width: "78%", aspectRatio: "1 / 1.05", borderRadius: "1.6em", background: "linear-gradient(160deg,#f7f8fc,#d9dcea)", boxShadow: "0 1.6em 3em -1em rgba(0,0,0,0.6)", padding: "1em", color: P.ink }}>
            <div style={{ borderRadius: "0.8em", background: bad ? "#ffe3df" : "#dfe9e3", padding: "0.8em 0.6em", textAlign: "center", boxShadow: "inset 0 0.15em 0.4em rgba(0,0,0,0.15)" }}>
              <div style={{ fontSize: "2.3em", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: bad ? P.badInk : "#1d3a2a", lineHeight: 1 }}>{formatDecimal(current.value)}°</div>
              <div style={{ fontSize: "0.7em", marginTop: "0.3em", color: P.ink2, fontVariantNumeric: "tabular-nums" }}>{current.time}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35em", marginTop: "0.7em", fontSize: "0.72em", fontWeight: 600, color: P.ink2 }}>
              <Wifi style={{ width: "1.1em", height: "1.1em", color: P.indigo }} />
              Wi-Fi датчик
            </div>
            {beat > 0 ? (
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: "1.6em", boxShadow: `0 0 0 ${(1 - beat) * 1.2}em rgba(124,245,192,${beat * 0.45})` }} />
            ) : null}
          </div>
          <div style={{ textAlign: "center", marginTop: "1em", fontSize: "0.8em", fontWeight: 600 }}>{DEMO.vitrine}</div>
          <div style={{ textAlign: "center", marginTop: "0.3em", fontSize: "0.66em", color: "rgba(255,255,255,0.65)" }}>показание раз в час — в журнал, без телефона</div>
        </div>
      </div>
      <Rail
        t={t}
        steps={[
          { label: "Датчик меряет", at: 0 },
          { label: "Раз в час — в журнал", at: 0.85 },
          { label: "Вне нормы — уведомление", at: 3.9 },
        ]}
      />
      {bad ? (
        <Toast
          t={t}
          at={3.95}
          channel="Telegram · ответственному"
          title={UI.deviationTitle}
          lines={[`Оборудование: ${DEMO.vitrine}`, `Сейчас: ${pdfNumber(current.value)}°C`, `Норма: от ${FRIDGE_NORM.min} до ${FRIDGE_NORM.max}°C`]}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------
 * Кадр целиком
 * ------------------------------------------------------------------- */

export function SceneFrame({ frame, fridgeTemp, bodyTemp, today, qr }: SceneProps) {
  const { chapter, local } = chapterAt(frame);
  const t = local / FPS;
  // Короткий «вход» главы: без чёрного кадра, просто мягкое проявление.
  const enter = interpolate(t, [0, 0.25], [0.35, 1], { easing: ease.out });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: enter }}>
      <Backdrop chapter={chapter} t={t} />
      <Place chapter={chapter} />
      {chapter.id === "fridge" ? <FridgeScene t={t} value={fridgeTemp} today={today} qr={qr} photo={chapter.photo} /> : null}
      {chapter.id === "locker" ? <LockerScene t={t} bodyTemp={bodyTemp} today={today} qr={qr} photo={chapter.photo} /> : null}
      {chapter.id === "uv" ? <UvScene t={t} today={today} qr={qr} photo={chapter.photo} /> : null}
      {chapter.id === "fryer" ? <FryerScene t={t} today={today} qr={qr} photo={chapter.photo} /> : null}
      {chapter.id === "forgot" ? <ForgotScene t={t} today={today} /> : null}
      {chapter.id === "sensor" ? <SensorScene t={t} today={today} /> : null}
    </div>
  );
}

export const STAGE_BACKGROUND = P.stage;
