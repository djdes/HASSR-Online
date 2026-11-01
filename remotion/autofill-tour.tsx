import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BellRing,
  Camera,
  CheckCircle2,
  FileText,
  Hand,
  Thermometer,
  Truck,
  Wifi,
} from "lucide-react";

import {
  AUTOFILL_FPS,
  AUTOFILL_SIZE,
  AUTOFILL_TOTAL_FRAMES,
  autofillTimeline,
  type AutofillScene,
  type AutofillSceneId,
} from "@/lib/autofill-offer";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

/**
 * Ролик «Журналы, которые заполняются сами» (60 с, 1920×1080, без голоса).
 * Тексты сцен и тайминг — `src/lib/autofill-offer.ts` (из них же субтитры).
 * Экраны — схемы интерфейса в цветах дизайн-системы: слева источник
 * (датчик, накладная, ВСД, фото, график), справа журнал, в который он
 * пишет. Ничего, чего нет в продукте: что заполняет человек, показано
 * пустыми клетками «сотрудник».
 */

export const AUTOFILL_VIDEO_CONFIG = {
  fps: AUTOFILL_FPS,
  width: AUTOFILL_SIZE.width,
  height: AUTOFILL_SIZE.height,
  durationInFrames: AUTOFILL_TOTAL_FRAMES,
} as const;

const FONT = "Manrope, 'Segoe UI', system-ui, sans-serif";
const INK = "#05070f";
const INDIGO = "#5566f6";
const INDIGO_DEEP = "#3848c7";
const TEXT = "#0b1024";
const MUTED = "#6f7282";
const LINE = "#ececf4";
const RED = "#d2453b";
const GREEN = "#136b2a";
const ACCENT_TEXT: CSSProperties = {
  backgroundImage: "linear-gradient(100deg, #aab4ff 0%, #8b97ff 45%, #b9a8ff 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ---------------------------------------------------------------------
 * Приёмы
 * ------------------------------------------------------------------- */

/** 0 → 1 от кадра `delay` за `duration` кадров. */
function useProgress(delay: number, duration = 18): number {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, duration], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}

function rise(t: number, dy = 26): CSSProperties {
  return { opacity: t, transform: `translateY(${(1 - t) * dy}px)`, filter: `blur(${(1 - t) * 6}px)` };
}

function usePop(delay: number): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 180 } });
}

function withAccent(text: string, accent: string | null): ReactNode {
  if (!accent || !text.includes(accent)) return text;
  const [before, after] = text.split(accent);
  return (
    <>
      {before}
      <span style={ACCENT_TEXT}>{accent}</span>
      {after}
    </>
  );
}

/** Температура по-русски: «+3,8 °C». */
function celsius(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1).replace(".", ",")} °C`;
}

/* ---------------------------------------------------------------------
 * Каркас сцены
 * ------------------------------------------------------------------- */

const STAGE_BACKGROUND =
  "radial-gradient(1200px 700px at 85% -10%, rgba(85,102,246,0.28), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(124,92,255,0.18), transparent 60%), #05070f";

function SceneShell({ scene, centered = false, children }: { scene: AutofillScene; centered?: boolean; children?: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = Math.min(
    interpolate(frame, [0, 12], [0, 1], clamp),
    interpolate(frame, [scene.frames - 10, scene.frames], [1, 0], clamp),
  );
  const head = useProgress(4, 20);
  const sub = useProgress(14, 20);
  return (
    <AbsoluteFill style={{ background: STAGE_BACKGROUND, fontFamily: FONT, opacity }}>
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          top: centered ? 300 : 80,
          textAlign: centered ? "center" : "left",
        }}
      >
        {scene.chapter ? (
          <div style={{ ...rise(head, 14), color: "#8b97ff", fontSize: 24, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {scene.chapter}
          </div>
        ) : null}
        <div style={{ ...rise(head), marginTop: scene.chapter ? 14 : 0, color: "#fff", fontSize: centered ? 84 : 64, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
          {withAccent(scene.title, scene.accent)}
        </div>
        <div
          style={{
            ...rise(sub),
            marginTop: 18,
            color: "rgba(255,255,255,0.72)",
            fontSize: centered ? 32 : 28,
            lineHeight: 1.4,
            maxWidth: centered ? 1300 : 1500,
            marginLeft: centered ? "auto" : 0,
            marginRight: centered ? "auto" : 0,
          }}
        >
          {scene.sub}
        </div>
      </div>
      {children}
    </AbsoluteFill>
  );
}

/** Рабочая область сцены под заголовком: источник слева, журнал справа. */
function Stage({ left, right }: { left: ReactNode; right: ReactNode }) {
  const arrow = useProgress(40, 24);
  return (
    <div style={{ position: "absolute", left: 120, right: 120, top: 340, bottom: 80, display: "flex", gap: 0, alignItems: "stretch" }}>
      <div style={{ width: 600, position: "relative" }}>{left}</div>
      <div style={{ width: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="56" height="28" viewBox="0 0 56 28" style={{ opacity: arrow, transform: `translateX(${(1 - arrow) * -16}px)` }}>
          <path d="M2 14h46M38 4l12 10-12 10" stroke="#8b97ff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ flex: 1, position: "relative" }}>{right}</div>
    </div>
  );
}

function Panel({ children, delay = 18, style }: { children: ReactNode; delay?: number; style?: CSSProperties }) {
  const t = useProgress(delay, 22);
  return (
    <div
      style={{
        ...rise(t, 40),
        height: "100%",
        boxSizing: "border-box",
        borderRadius: 32,
        background: "#fff",
        padding: 32,
        color: TEXT,
        boxShadow: "0 40px 120px -40px rgba(0,0,0,0.65)",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function PanelTitle({ icon, children, hint }: { icon?: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {icon ? (
        <span style={{ display: "flex", width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 16, background: "#eef1ff", color: INDIGO_DEEP }}>
          {icon}
        </span>
      ) : null}
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>{children}</div>
        {hint ? <div style={{ marginTop: 2, fontSize: 18, color: MUTED }}>{hint}</div> : null}
      </div>
    </div>
  );
}

function Chip({ children, tone = "indigo" }: { children: ReactNode; tone?: "indigo" | "muted" | "green" | "red" }) {
  const colors = {
    indigo: { background: "#eef1ff", color: INDIGO_DEEP, border: "transparent" },
    muted: { background: "#fff", color: "#9b9fb3", border: "#dcdfed" },
    green: { background: "#ecfdf5", color: GREEN, border: "transparent" },
    red: { background: "#fff1ef", color: RED, border: "transparent" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "4px 12px",
        fontSize: 17,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: colors.background,
        color: colors.color,
        border: `1.5px ${tone === "muted" ? "dashed" : "solid"} ${colors.border}`,
      }}
    >
      {children}
    </span>
  );
}

type Row = { cells: ReactNode[]; at: number; alert?: boolean };

/** Таблица журнала: строки появляются по очереди и подсвечиваются при записи. */
function JournalTable({ columns, widths, rows }: { columns: string[]; widths: string; rows: Row[] }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ marginTop: 24, borderRadius: 20, border: `1.5px solid ${LINE}`, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: widths, background: "#fafbff", color: MUTED, fontSize: 17, fontWeight: 600 }}>
        {columns.map((column) => (
          <div key={column} style={{ padding: "12px 16px" }}>{column}</div>
        ))}
      </div>
      {rows.map((row, index) => {
        const t = interpolate(frame - row.at, [0, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        const glow = interpolate(frame - row.at, [0, 10, 50], [0, 1, 0], clamp);
        return (
          <div
            key={index}
            style={{
              display: "grid",
              gridTemplateColumns: widths,
              alignItems: "center",
              borderTop: `1.5px solid ${LINE}`,
              fontSize: 21,
              opacity: t,
              transform: `translateX(${(1 - t) * 30}px)`,
              background: row.alert ? `rgba(210,69,59,${0.06 + glow * 0.08})` : `rgba(85,102,246,${glow * 0.1})`,
            }}
          >
            {row.cells.map((cell, cellIndex) => (
              <div key={cellIndex} style={{ padding: "12px 16px", minWidth: 0 }}>{cell}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Сцены
 * ------------------------------------------------------------------- */

function IntroScene({ scene }: { scene: AutofillScene }) {
  const sources = ["Датчики", "iiko и ЭДО", "«Меркурий»", "Фото табло", "График смен"];
  return (
    <SceneShell scene={scene} centered>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, display: "flex", justifyContent: "center", gap: 18 }}>
        {sources.map((label, index) => (
          <IntroChip key={label} label={label} delay={44 + index * 10} />
        ))}
      </div>
    </SceneShell>
  );
}

function IntroChip({ label, delay }: { label: string; delay: number }) {
  const pop = usePop(delay);
  return (
    <span
      style={{
        opacity: Math.min(1, pop * 1.4),
        transform: `scale(${0.7 + pop * 0.3})`,
        borderRadius: 999,
        padding: "14px 28px",
        fontSize: 28,
        fontWeight: 600,
        color: "#fff",
        background: "rgba(255,255,255,0.08)",
        border: "1.5px solid rgba(255,255,255,0.18)",
      }}
    >
      {label}
    </span>
  );
}

const SENSOR_ROWS: Array<{ time: string; one: number; two: number; at: number }> = [
  { time: "08:00", one: 3.8, two: 4.0, at: 50 },
  { time: "09:00", one: 3.9, two: 4.2, at: 80 },
  { time: "10:00", one: 4.1, two: 4.4, at: 110 },
  { time: "11:00", one: 3.7, two: 5.1, at: 140 },
];
const ALERT_AT = 205;

function SensorsScene({ scene }: { scene: AutofillScene }) {
  const frame = useCurrentFrame();
  const live = 3.8 + Math.sin(frame / 18) * 0.15;
  const two = frame < ALERT_AT - 25 ? 4.6 : interpolate(frame, [ALERT_AT - 25, ALERT_AT], [5.1, 9.4], clamp);
  const toast = usePop(ALERT_AT + 10);
  const twoAlert = two > 6;
  return (
    <SceneShell scene={scene}>
      <Stage
        left={
          <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "100%" }}>
            <DeviceCard name="Холодильник №1 · Кухня" value={live} alert={false} delay={18} />
            <DeviceCard name="Холодильник №2 · Заготовка" value={two} alert={twoAlert} delay={28} />
          </div>
        }
        right={
          <Panel delay={30}>
            <PanelTitle icon={<FileText size={28} />} hint="1 ноября · Кухня">
              Журнал температуры холодильников
            </PanelTitle>
            <JournalTable
              columns={["Время", "Холодильник №1", "Холодильник №2", "Кто записал"]}
              widths="0.8fr 1.2fr 1.2fr 1.2fr"
              rows={[
                ...SENSOR_ROWS.map((row) => ({
                  at: row.at,
                  cells: [row.time, celsius(row.one), celsius(row.two), <Chip key="s"><Wifi size={16} /> датчик</Chip>],
                })),
                {
                  at: ALERT_AT,
                  alert: true,
                  cells: ["12:00", celsius(3.8), <span key="a" style={{ color: RED, fontWeight: 700 }}>{celsius(9.4)}</span>, <Chip key="s"><Wifi size={16} /> датчик</Chip>],
                },
              ]}
            />
            <div
              style={{
                position: "absolute",
                right: 28,
                bottom: 28,
                opacity: Math.min(1, toast * 1.3),
                transform: `translateY(${(1 - toast) * 40}px)`,
                display: "flex",
                alignItems: "center",
                gap: 16,
                borderRadius: 22,
                padding: "16px 22px",
                background: TEXT,
                color: "#fff",
                boxShadow: "0 24px 60px -20px rgba(11,16,36,0.6)",
              }}
            >
              <span style={{ display: "flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, background: RED }}>
                <BellRing size={26} />
              </span>
              <div>
                <div style={{ fontSize: 21, fontWeight: 700 }}>Холодильник №2: {celsius(9.4)} — выше нормы</div>
                <div style={{ fontSize: 17, color: "rgba(255,255,255,0.7)" }}>Тревога ушла руководителю точки</div>
              </div>
            </div>
          </Panel>
        }
      />
    </SceneShell>
  );
}

function DeviceCard({ name, value, alert, delay }: { name: string; value: number; alert: boolean; delay: number }) {
  return (
    <Panel delay={delay} style={{ flex: 1, height: "auto", padding: 28 }}>
      <PanelTitle icon={<Thermometer size={28} />} hint="Wi-Fi датчик · запись раз в час">
        {name}
      </PanelTitle>
      <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: "-0.03em", color: alert ? RED : TEXT, fontVariantNumeric: "tabular-nums" }}>
          {celsius(value)}
        </span>
        <Chip tone={alert ? "red" : "green"}>Норма +2…+6 °C</Chip>
      </div>
    </Panel>
  );
}

const INVOICE_LINES = [
  { name: "Молоко 3,2 %", qty: "24 л", until: "06.11", at: 80 },
  { name: "Сметана 20 %", qty: "6 кг", until: "09.11", at: 125 },
  { name: "Творог 9 %", qty: "5 кг", until: "07.11", at: 170 },
];

function InvoicesScene({ scene }: { scene: AutofillScene }) {
  const frame = useCurrentFrame();
  const note = useProgress(230, 20);
  return (
    <SceneShell scene={scene}>
      <Stage
        left={
          <Panel delay={18}>
            <PanelTitle icon={<Truck size={28} />} hint="ООО «Молочный двор»">
              УПД № 1452 от 01.11
            </PanelTitle>
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <Chip>iiko</Chip>
              <Chip>Диадок</Chip>
              <Chip>СБИС</Chip>
            </div>
            <div style={{ marginTop: 22, borderRadius: 20, border: `1.5px solid ${LINE}`, overflow: "hidden" }}>
              {INVOICE_LINES.map((line, index) => {
                const active = interpolate(frame - line.at, [-12, 0, 30], [0, 1, 0.35], clamp);
                return (
                  <div
                    key={line.name}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr 0.8fr 1fr",
                      padding: "16px 18px",
                      fontSize: 22,
                      borderTop: index ? `1.5px solid ${LINE}` : "none",
                      background: `rgba(85,102,246,${active * 0.12})`,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{line.name}</span>
                    <span>{line.qty}</span>
                    <span style={{ color: MUTED }}>до {line.until}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        }
        right={
          <Panel delay={30}>
            <PanelTitle icon={<FileText size={28} />} hint="Строки из накладной — сами">
              Журнал приёмки и входного контроля
            </PanelTitle>
            <JournalTable
              columns={["Продукт", "Кол-во", "Документ", "Годен до", "t° продукта", "Решение"]}
              widths="1.5fr 0.8fr 1fr 0.9fr 1.1fr 1.1fr"
              rows={INVOICE_LINES.map((line) => ({
                at: line.at + 14,
                cells: [
                  <span key="n" style={{ fontWeight: 600 }}>{line.name}</span>,
                  line.qty,
                  "УПД 1452",
                  line.until,
                  <Chip key="t" tone="muted">сотрудник</Chip>,
                  <Chip key="d" tone="muted">сотрудник</Chip>,
                ],
              }))}
            />
            <div style={{ ...rise(note, 16), position: "absolute", left: 32, right: 32, bottom: 28, display: "flex", alignItems: "center", gap: 12, fontSize: 20, color: MUTED }}>
              <Hand size={24} color={INDIGO} />
              Температуру, упаковку и решение «принять или вернуть» вносит сотрудник на приёмке
            </div>
          </Panel>
        }
      />
    </SceneShell>
  );
}

function MercuryScene({ scene }: { scene: AutofillScene }) {
  const frame = useCurrentFrame();
  const typed = "+2,1 °C".slice(0, Math.max(0, Math.floor((frame - 100) / 3)));
  const decided = frame >= 128;
  const press = usePop(160);
  const done = frame >= 172;
  const button = useProgress(140, 14);
  return (
    <SceneShell scene={scene}>
      <Stage
        left={
          <Panel delay={18}>
            <PanelTitle icon={<FileText size={28} />} hint="ФГИС «Меркурий»">
              Ветеринарный документ
            </PanelTitle>
            <div style={{ marginTop: 26, display: "grid", gap: 16, fontSize: 22 }}>
              <Field label="Продукция" value="Говядина охлаждённая" />
              <Field label="Объём" value="18 кг" />
              <Field label="Отправитель" value="ООО «Фермерское хозяйство»" />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: MUTED }}>Статус</span>
                {done ? <Chip tone="green"><CheckCircle2 size={16} /> Погашен</Chip> : <Chip>Оформлен</Chip>}
              </div>
            </div>
          </Panel>
        }
        right={
          <Panel delay={30}>
            <PanelTitle icon={<FileText size={28} />} hint="Строка из ВСД — сама, проверку — человек">
              Входной контроль
            </PanelTitle>
            <JournalTable
              columns={["Продукт", "Кол-во", "Документ", "Годен до", "t° продукта", "Решение"]}
              widths="1.5fr 0.8fr 0.8fr 0.9fr 1.1fr 1.1fr"
              rows={[
                {
                  at: 60,
                  cells: [
                    <span key="n" style={{ fontWeight: 600 }}>Говядина охл.</span>,
                    "18 кг",
                    "ВСД",
                    "05.11",
                    typed ? <span key="t" style={{ fontWeight: 700 }}>{typed}</span> : <Chip key="t" tone="muted">сотрудник</Chip>,
                    decided ? <Chip key="d" tone="green">Принято</Chip> : <Chip key="d" tone="muted">сотрудник</Chip>,
                  ],
                },
              ]}
            />
            <div style={{ marginTop: 18, fontSize: 19, color: MUTED, opacity: decided ? 1 : 0 }}>Заполнила: Анна, повар · 10:42</div>
            <div style={{ position: "absolute", left: 32, bottom: 32, opacity: button, transform: `scale(${done ? 1 : 1 - Math.max(0, Math.min(press, 1) * 0.06)})` }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 18,
                  padding: "16px 28px",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#fff",
                  background: done ? GREEN : INDIGO,
                }}
              >
                {done ? (
                  <>
                    <CheckCircle2 size={24} /> ВСД погашен
                  </>
                ) : (
                  "Погасить ВСД"
                )}
              </span>
            </div>
          </Panel>
        }
      />
    </SceneShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

const SHOT_AT = 80;

function PhotoScene({ scene }: { scene: AutofillScene }) {
  const frame = useCurrentFrame();
  const flash = interpolate(frame, [SHOT_AT, SHOT_AT + 3, SHOT_AT + 12], [0, 0.9, 0], clamp);
  const recognized = usePop(SHOT_AT + 16);
  const phone = useProgress(16, 24);
  return (
    <SceneShell scene={scene}>
      <Stage
        left={
          <div style={{ ...rise(phone, 40), height: "100%", display: "flex", justifyContent: "center" }}>
            <div style={{ width: 340, height: "100%", borderRadius: 52, background: "#111526", border: "10px solid #1d2238", position: "relative", overflow: "hidden", boxShadow: "0 40px 120px -40px rgba(0,0,0,0.8)" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(400px 300px at 50% 40%, #2a3045, #0d1020)" }} />
              {/* Табло холодильника в видоискателе. */}
              <div style={{ position: "absolute", left: 50, right: 50, top: 170, height: 170, borderRadius: 18, background: "#1c2a22", border: "4px solid #3b4b40", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span style={{ fontFamily: "'DejaVu Sans Mono', monospace", fontSize: 84, fontWeight: 700, color: "#9dffb0", textShadow: "0 0 18px rgba(157,255,176,0.6)" }}>4.2</span>
                <span style={{ fontFamily: "'DejaVu Sans Mono', monospace", fontSize: 28, color: "#9dffb0", alignSelf: "flex-start", marginTop: 40 }}>°C</span>
              </div>
              {[
                { left: 30, top: 140, borderLeft: true, borderTop: true },
                { right: 30, top: 140, borderRight: true, borderTop: true },
                { left: 30, top: 330, borderLeft: true, borderBottom: true },
                { right: 30, top: 330, borderRight: true, borderBottom: true },
              ].map((corner, index) => (
                <div
                  key={index}
                  style={{
                    position: "absolute",
                    width: 40,
                    height: 40,
                    left: corner.left,
                    right: corner.right,
                    top: corner.top,
                    borderLeft: corner.borderLeft ? "4px solid #fff" : undefined,
                    borderRight: corner.borderRight ? "4px solid #fff" : undefined,
                    borderTop: corner.borderTop ? "4px solid #fff" : undefined,
                    borderBottom: corner.borderBottom ? "4px solid #fff" : undefined,
                    opacity: 0.85,
                  }}
                />
              ))}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, display: "flex", justifyContent: "center" }}>
                <span style={{ width: 84, height: 84, borderRadius: 999, border: "6px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 62, height: 62, borderRadius: 999, background: "#fff", transform: `scale(${frame >= SHOT_AT && frame < SHOT_AT + 6 ? 0.85 : 1})` }} />
                </span>
              </div>
              <div style={{ position: "absolute", left: 12, right: 12, top: 390, display: "flex", justifyContent: "center", opacity: Math.min(1, recognized * 1.4), transform: `scale(${0.8 + recognized * 0.2})` }}>
                <span style={{ borderRadius: 18, padding: "12px 18px", background: "#fff", color: TEXT, fontSize: 20, fontWeight: 700, display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                  <CheckCircle2 size={24} color={GREEN} /> Распознано: {celsius(4.2)}
                </span>
              </div>
              <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash }} />
            </div>
          </div>
        }
        right={
          <Panel delay={30}>
            <PanelTitle icon={<FileText size={28} />} hint="Холодильник №3 · Бар">
              Журнал температуры холодильников
            </PanelTitle>
            <JournalTable
              columns={["Время", "Показание", "Кто записал"]}
              widths="0.8fr 1.2fr 1.6fr"
              rows={[
                { at: 40, cells: ["12:00", celsius(3.9), "Олег, бармен"] },
                { at: 52, cells: ["13:00", celsius(4.0), "Олег, бармен"] },
                {
                  at: SHOT_AT + 34,
                  cells: [
                    "14:00",
                    <span key="v" style={{ fontWeight: 700 }}>{celsius(4.2)}</span>,
                    <Chip key="c"><Camera size={16} /> с фото табло</Chip>,
                  ],
                },
              ]}
            />
          </Panel>
        }
      />
    </SceneShell>
  );
}

type Shift = "work" | "off" | "vacation" | "sick";
const STAFF: Array<{ name: string; days: Shift[] }> = [
  { name: "Анна", days: ["work", "work", "work", "work", "work", "off", "off"] },
  { name: "Олег", days: ["off", "work", "work", "work", "work", "work", "off"] },
  { name: "Ирина", days: ["vacation", "vacation", "vacation", "vacation", "vacation", "vacation", "vacation"] },
  { name: "Самат", days: ["work", "work", "sick", "sick", "work", "work", "off"] },
];
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const SHIFT_SHORT: Record<Shift, string> = { work: "раб.", off: "вых.", vacation: "отп.", sick: "б/л" };
const SHIFT_COLORS: Record<Shift, { background: string; color: string }> = {
  work: { background: "#fff", color: MUTED },
  off: { background: "#f1f2f7", color: "#4b4f63" },
  vacation: { background: "#eef1ff", color: INDIGO_DEEP },
  sick: { background: "#fff6e6", color: "#9a5b00" },
};

function ScheduleScene({ scene }: { scene: AutofillScene }) {
  const frame = useCurrentFrame();
  const note = useProgress(150, 18);
  const grid = (mode: "schedule" | "journal") => (
    <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: `${mode === "schedule" ? 92 : 120}px repeat(7, 1fr)`, gap: 6, fontSize: mode === "schedule" ? 17 : 18 }}>
      <div />
      {DAYS.map((day) => (
        <div key={day} style={{ textAlign: "center", color: MUTED, fontWeight: 600 }}>{day}</div>
      ))}
      {STAFF.map((person) => (
        <Fragmentless key={person.name}>
          <div style={{ fontWeight: 600, alignSelf: "center" }}>{person.name}</div>
          {person.days.map((shift, day) => {
            const at = 56 + day * 12;
            const shown = mode === "schedule" ? 1 : shift === "work" ? 0 : interpolate(frame - at, [0, 10], [0, 1], clamp);
            const colors = SHIFT_COLORS[shift];
            if (mode === "journal" && shift === "work") {
              return <div key={day} style={{ height: 52, borderRadius: 12, border: `1.5px dashed #dcdfed` }} />;
            }
            return (
              <div
                key={day}
                style={{
                  height: 52,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  background: colors.background,
                  color: colors.color,
                  border: mode === "schedule" && shift === "work" ? `1.5px solid ${LINE}` : "none",
                  opacity: mode === "journal" ? shown : 1,
                  transform: mode === "journal" ? `scale(${0.8 + shown * 0.2})` : undefined,
                }}
              >
                {SHIFT_SHORT[shift]}
              </div>
            );
          })}
        </Fragmentless>
      ))}
    </div>
  );
  return (
    <SceneShell scene={scene}>
      <Stage
        left={
          <Panel delay={18}>
            <PanelTitle hint="3–9 ноября">График смен</PanelTitle>
            {grid("schedule")}
          </Panel>
        }
        right={
          <Panel delay={30}>
            <PanelTitle icon={<FileText size={28} />} hint="Отметки из графика — сами">
              Гигиенический журнал
            </PanelTitle>
            {grid("journal")}
            <div style={{ ...rise(note, 14), marginTop: 22, display: "flex", alignItems: "center", gap: 12, fontSize: 20, color: MUTED }}>
              <Hand size={24} color={INDIGO} />
              Рабочие дни отмечает смена — после осмотра
            </div>
          </Panel>
        }
      />
    </SceneShell>
  );
}

/** Сетка CSS ждёт детей подряд: обёртка без собственного узла. */
function Fragmentless({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const HUMAN_ITEMS = [
  "Температура продукта на приёмке",
  "Органолептика и бракераж",
  "Допуск сотрудника к работе",
  "Подпись ответственного",
];

function HumanScene({ scene }: { scene: AutofillScene }) {
  return (
    <SceneShell scene={scene} centered>
      <div style={{ position: "absolute", left: 0, right: 0, top: 620, display: "flex", justifyContent: "center", gap: 18 }}>
        {HUMAN_ITEMS.map((item, index) => (
          <HumanItem key={item} label={item} delay={30 + index * 12} />
        ))}
      </div>
    </SceneShell>
  );
}

function HumanItem({ label, delay }: { label: string; delay: number }) {
  const t = useProgress(delay, 16);
  return (
    <div style={{ ...rise(t, 20), display: "flex", alignItems: "center", gap: 12, borderRadius: 22, padding: "18px 24px", background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.16)", color: "#fff", fontSize: 24, fontWeight: 600 }}>
      <Hand size={26} color="#aab4ff" />
      {label}
    </div>
  );
}

function OutroScene({ scene }: { scene: AutofillScene }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], clamp);
  const logo = useProgress(6, 24);
  const title = useProgress(22, 20);
  const url = usePop(44);
  const trial = useProgress(64, 18);
  return (
    <AbsoluteFill style={{ background: STAGE_BACKGROUND, fontFamily: FONT, opacity, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div
        style={{
          ...rise(logo, 20),
          width: 520,
          height: 520 / (2006 / 533),
          backgroundColor: "#fff",
          WebkitMaskImage: `url(${staticFile("brand/wordmark.png")})`,
          maskImage: `url(${staticFile("brand/wordmark.png")})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
      <div style={{ ...rise(title), marginTop: 48, color: "#fff", fontSize: 64, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {withAccent(scene.title, scene.accent)}
      </div>
      <div
        style={{
          marginTop: 36,
          opacity: Math.min(1, url * 1.3),
          transform: `scale(${0.85 + url * 0.15})`,
          borderRadius: 999,
          padding: "18px 36px",
          background: INDIGO,
          color: "#fff",
          fontSize: 36,
          fontWeight: 700,
          boxShadow: "0 24px 60px -20px rgba(85,102,246,0.8)",
        }}
      >
        {scene.sub}
      </div>
      <div style={{ ...rise(trial, 12), marginTop: 26, color: "rgba(255,255,255,0.7)", fontSize: 26 }}>
        {TRIAL_DAYS} дней бесплатно · все возможности · без карты
      </div>
    </AbsoluteFill>
  );
}

const SCENES: Record<AutofillSceneId, (props: { scene: AutofillScene }) => React.JSX.Element> = {
  intro: IntroScene,
  sensors: SensorsScene,
  invoices: InvoicesScene,
  mercury: MercuryScene,
  photo: PhotoScene,
  schedule: ScheduleScene,
  human: HumanScene,
  outro: OutroScene,
};

export const AutofillTour: React.FC = () => (
  <AbsoluteFill style={{ background: INK }}>
    {autofillTimeline().map((scene) => {
      const Scene = SCENES[scene.id];
      return (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames} name={scene.id}>
          <Scene scene={scene} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
