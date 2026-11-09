import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { FPS } from "@/components/landing/qr-player/chapters";
import type { ExtPart } from "./timeline";
import type { Showcase, ShowcaseShot } from "./showcases";

/**
 * Сцена-экран расширенного ролика: настоящий экран сетапа в телефоне или
 * ноутбуке, справа — шаги, которые загораются в такт голосу, сверху — место.
 * Язык тот же, что у кухонных сцен на главной: тёмная сцена, фото места,
 * индиго-акцент, шаги с мятными галочками, мягкий наезд камеры.
 */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const STAGE = "#0f1430";
const MINT = "#7cf5c0";
const INDIGO = "#5566f6";

/** Кадр части, с которого голос произносит слово `index`. */
function wordFrame(part: ExtPart, index: number): number {
  const words = part.voice.words;
  const word = words[Math.max(0, Math.min(index, words.length - 1))];
  return part.voiceOffset + Math.round(word.start * FPS);
}

function ease(frame: number, from: number, duration: number, curve = Easing.out(Easing.cubic)): number {
  return interpolate(frame, [from, from + duration], [0, 1], { ...clamp, easing: curve });
}

/* ---------------------------------------------------------------------
 * Фон
 * ------------------------------------------------------------------- */

function PhotoBackdrop({ photo, accent, frame, total }: { photo: string; accent: string; frame: number; total: number }) {
  const enter = ease(frame, 0, 14);
  const drift = interpolate(frame, [0, total], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: STAGE }}>
      <Img
        src={staticFile(photo)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.88 * (0.55 + 0.45 * enter),
          filter: "saturate(0.86) brightness(0.6) contrast(1.06) blur(2px)",
          transform: `scale(${(1.12 - 0.05 * drift).toFixed(4)}) translateX(${((1 - enter) * 2.2).toFixed(3)}%)`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(110% 80% at 0% 0%, ${accent}3d, transparent 55%)` }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(8,11,26,0.2) 0%, rgba(8,11,26,0.66) 33%, rgba(8,11,26,0.5) 63%, rgba(8,11,26,0.12) 100%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,11,26,0) 45%, rgba(8,11,26,0.7) 100%)" }} />
    </div>
  );
}

/** «Кабинет руководителя» — тёмный герой дизайн-системы, без фото. */
function OfficeBackdrop({ accent, frame }: { accent: string; frame: number }) {
  const drift = (speed: number, amount: number) => Math.sin((frame / FPS) * speed) * amount;
  const blob = (style: CSSProperties): CSSProperties => ({ position: "absolute", borderRadius: "9999px", ...style });
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0b1024" }}>
      <div style={blob({ left: -220 + drift(0.35, 40), top: -260 + drift(0.27, 30), width: 860, height: 860, background: INDIGO, opacity: 0.34, filter: "blur(170px)" })} />
      <div style={blob({ right: -260 + drift(0.3, 50), bottom: -320 + drift(0.22, 40), width: 900, height: 900, background: "#7a5cff", opacity: 0.26, filter: "blur(180px)" })} />
      <div style={blob({ left: 760 + drift(0.25, 60), top: 460 + drift(0.31, 30), width: 520, height: 520, background: accent, opacity: 0.16, filter: "blur(150px)" })} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(80% 70% at 50% 45%, black, transparent)",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Экран: картинка, которая плавно «прокручивается» и подсвечивает нужное
 * ------------------------------------------------------------------- */

function ShotImage({ shot, part, frame, width, height }: { shot: ShowcaseShot; part: ExtPart; frame: number; width: number; height: number }) {
  // Масштаб: картинка по ширине экрана устройства.
  const scale = width / shot.width;
  const shownHeight = shot.height * scale;
  const maxScroll = Math.max(0, shownHeight - height);
  // Прокрутка: ключевые точки — [слово голоса, доля прокрутки 0…1].
  const keys = shot.scroll ?? [];
  let scroll = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const at = wordFrame(part, keys[index][0]);
    const prev = index === 0 ? 0 : keys[index - 1][1];
    if (frame >= at - 12) scroll = interpolate(frame, [at - 12, at + 18], [prev, keys[index][1]], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  }
  const y = -scroll * maxScroll;
  // Наезд на нужное место: камера подводит точку фокуса к центру экрана и
  // приближает, не показывая края снимка.
  let zoom = 1;
  let tx = 0;
  let ty = y;
  for (const key of shot.focus ?? []) {
    const at = wordFrame(part, key.word);
    const value = ease(frame, at - 10, 24, Easing.inOut(Easing.cubic));
    if (value <= 0) continue;
    const z = key.scale;
    const targetX = Math.min(0, Math.max(width - width * z, width / 2 - key.x * scale * z));
    const targetY = Math.min(0, Math.max(height - shownHeight * z, height / 2 - key.y * scale * z));
    zoom += (z - zoom) * value;
    tx += (targetX - tx) * value;
    ty += (targetY - ty) * value;
  }
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width, height: shownHeight, transformOrigin: "0 0", transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${zoom.toFixed(4)})` }}>
      <Img src={staticFile(shot.src)} style={{ display: "block", width, height: shownHeight }} />
      {(shot.highlights ?? []).map((box, index) => {
        const at = wordFrame(part, box.word);
        const value = ease(frame, at - 4, 12);
        if (value <= 0) return null;
        const color = box.color ?? INDIGO;
        const pulse = (Math.sin(((frame - at) / FPS) * 4.2) + 1) / 2;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: box.x * scale - 6,
              top: box.y * scale - 6,
              width: box.w * scale + 12,
              height: box.h * scale + 12,
              borderRadius: (box.radius ?? 16) * scale + 6,
              boxShadow: `0 0 0 ${(3 + pulse * 2).toFixed(2)}px ${color}, 0 0 0 ${(10 + pulse * 6).toFixed(2)}px ${color}33, 0 18px 50px -12px ${color}88`,
              opacity: value,
              transform: `scale(${(1.06 - 0.06 * value).toFixed(4)})`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Экран устройства: снимки сменяются мягкой склейкой на нужном слове голоса. */
function ScreenImage({ shots, part, frame, width, height }: { shots: ShowcaseShot[]; part: ExtPart; frame: number; width: number; height: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f4f5fa" }}>
      {shots.map((shot, index) => {
        const next = shots[index + 1];
        const inAt = index === 0 ? -100 : wordFrame(part, shot.fromWord ?? 0) - 8;
        const shown = index === 0 ? 1 : ease(frame, inAt, 12);
        const gone = next ? ease(frame, wordFrame(part, next.fromWord ?? 0) + 4, 10) : 0;
        if (shown <= 0 || gone >= 1) return null;
        return (
          <div key={shot.src} style={{ position: "absolute", inset: 0, opacity: shown * (1 - gone), transform: `translateY(${((1 - shown) * 18).toFixed(2)}px)` }}>
            <ShotImage shot={shot} part={part} frame={frame} width={width} height={height} />
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Устройства
 * ------------------------------------------------------------------- */

const PHONE = { left: 118, top: 40, width: 470, height: 940 } as const;
const LAPTOP = { left: 86, top: 150, width: 1150, screenHeight: 719 } as const;

function Phone({ frame, children }: { frame: number; children: ReactNode }) {
  const t = frame / FPS;
  const tiltY = -5 + Math.sin(t * 0.8) * 1.4;
  const tiltX = 3 + Math.cos(t * 0.6) * 0.9;
  const roll = -0.7 + Math.sin(t * 0.45) * 0.45;
  const bob = Math.sin(t * 0.9) * 4;
  return (
    <div style={{ position: "absolute", left: PHONE.left, top: PHONE.top, width: PHONE.width, height: PHONE.height }}>
      <div style={{ position: "absolute", left: "8%", right: "4%", bottom: "-3.5%", height: "7%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.6), rgba(0,0,0,0))" }} />
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 62,
          padding: 5,
          background: "linear-gradient(150deg,#727892 0%,#262934 16%,#0d0f15 46%,#2c303c 74%,#808699 100%)",
          boxShadow: "0 70px 110px -40px rgba(0,0,0,0.78), 0 25px 45px -22px rgba(0,0,0,0.55)",
          transform: `perspective(1500px) translateY(${bob.toFixed(2)}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${roll}deg)`,
          transformOrigin: "50% 60%",
        }}
      >
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 58, padding: 9, background: "#070914" }}>
          <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 50, overflow: "hidden", background: "#f4f5fa" }}>
            {children}
            <div style={{ position: "absolute", left: "50%", top: 12, width: 120, height: 32, marginLeft: -60, borderRadius: 999, background: "#070914" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 32%)", pointerEvents: "none" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Laptop({ frame, children }: { frame: number; children: ReactNode }) {
  const t = frame / FPS;
  const tiltY = 7 + Math.sin(t * 0.5) * 1.1;
  const tiltX = 4 + Math.cos(t * 0.4) * 0.6;
  const screenWidth = LAPTOP.width - 36;
  return (
    <div style={{ position: "absolute", left: LAPTOP.left, top: LAPTOP.top, width: LAPTOP.width, transform: `perspective(2600px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`, transformOrigin: "40% 80%" }}>
      <div
        style={{
          position: "relative",
          width: LAPTOP.width,
          height: LAPTOP.screenHeight + 36,
          borderRadius: "28px 28px 10px 10px",
          padding: 18,
          background: "linear-gradient(160deg,#2b2f3d 0%,#0d0f15 40%,#1b1e28 100%)",
          boxShadow: "0 80px 140px -50px rgba(0,0,0,0.85), inset 0 0 0 1.5px rgba(255,255,255,0.1)",
        }}
      >
        <div style={{ position: "relative", width: screenWidth, height: LAPTOP.screenHeight, borderRadius: 8, overflow: "hidden", background: "#f4f5fa" }}>
          {children}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 30%)", pointerEvents: "none" }} />
        </div>
        <div style={{ position: "absolute", left: "50%", top: 6, width: 8, height: 8, marginLeft: -4, borderRadius: 999, background: "#2c3040" }} />
      </div>
      {/* Корпус с клавиатурой — тонкая полоса с выемкой. */}
      <div style={{ position: "relative", margin: "0 -64px", height: 26, borderRadius: "0 0 26px 26px", background: "linear-gradient(180deg,#9aa0b4 0%,#5d6274 45%,#2a2d38 100%)", boxShadow: "0 30px 50px -20px rgba(0,0,0,0.8)" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: 190, height: 10, marginLeft: -95, borderRadius: "0 0 12px 12px", background: "#474b5a" }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Место и шаги
 * ------------------------------------------------------------------- */

function PlaceLabel({ showcase, frame, left, top }: { showcase: Showcase; frame: number; left: number; top: number }) {
  const value = ease(frame, 6, 14);
  const Icon = showcase.icon;
  return (
    <div style={{ position: "absolute", left, top, display: "flex", alignItems: "center", gap: 12, color: "#ffffff", fontSize: 25, fontWeight: 600, opacity: value, transform: `translateY(${((1 - value) * 10).toFixed(2)}px)` }}>
      <span style={{ display: "inline-flex", width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, background: "rgba(124,245,192,0.14)", color: MINT }}>
        <Icon size={26} />
      </span>
      {showcase.place}
    </div>
  );
}

function Rail({ showcase, part, frame, left, top, width }: { showcase: Showcase; part: ExtPart; frame: number; left: number; top: number; width: number }) {
  const ats = showcase.steps.map((step) => wordFrame(part, step.word) - 3);
  const active = ats.reduce((acc, at, index) => (frame >= at ? index : acc), -1);
  const pulse = (Math.sin((frame / FPS) * 5.5) + 1) / 2;
  const enter = ease(frame, 4, 16);
  return (
    <ol style={{ position: "absolute", left, top, width, margin: 0, padding: 0, listStyle: "none", color: "#ffffff", fontSize: 27, opacity: enter }}>
      {showcase.steps.map((step, index) => {
        const done = index < active;
        const now = index === active;
        const last = index === showcase.steps.length - 1;
        const next = ats[index + 1];
        const fill = done ? 1 : now && next !== undefined ? interpolate(frame, [ats[index], next], [0, 1], clamp) : 0;
        const valueAt = next ?? ats[index] + 12;
        const valueIn = step.value !== undefined ? ease(frame, valueAt, 10) : 0;
        return (
          <li key={step.label} style={{ position: "relative", display: "flex", gap: 18, paddingBottom: last ? 0 : 26, opacity: now ? 1 : done ? 0.9 : 0.42 }}>
            {last ? null : (
              <span style={{ position: "absolute", left: 21, top: 50, bottom: 6, width: 3, borderRadius: 999, background: "rgba(255,255,255,0.16)", overflow: "hidden" }}>
                <span style={{ display: "block", width: "100%", height: `${(fill * 100).toFixed(1)}%`, background: `linear-gradient(180deg,${MINT},#8b97ff)` }} />
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                width: 44,
                height: 44,
                flex: "none",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                fontWeight: 700,
                background: done ? MINT : now ? INDIGO : "rgba(255,255,255,0.1)",
                color: done ? "#0b3a26" : "#ffffff",
                boxShadow: now ? `0 0 0 ${(5 + pulse * 4).toFixed(2)}px rgba(85,102,246,${(0.38 - pulse * 0.14).toFixed(3)})` : undefined,
              }}
            >
              {done ? <Check size={26} strokeWidth={3} /> : <span style={{ fontSize: 22 }}>{index + 1}</span>}
            </span>
            <span style={{ minWidth: 0, paddingTop: 5 }}>
              <span style={{ display: "block", fontWeight: now ? 700 : 500, lineHeight: 1.25 }}>{step.label}</span>
              {valueIn > 0 ? (
                <span style={{ display: "block", marginTop: 5, fontSize: 23, fontWeight: 600, lineHeight: 1.25, color: step.tone === "bad" ? "#ff9a8f" : MINT, opacity: valueIn, transform: `translateY(${((1 - valueIn) * 8).toFixed(2)}px)` }}>
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

/** Уведомление поверх сцены (сводка в Telegram и MAX). */
function Note({ part, frame, note }: { part: ExtPart; frame: number; note: NonNullable<Showcase["note"]> }) {
  const at = wordFrame(part, note.word) - 6;
  const value = ease(frame, at, 16, Easing.out(Easing.back(1.4)));
  if (value <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: note.left,
        top: note.top,
        width: 560,
        padding: "22px 26px 24px",
        borderRadius: 30,
        background: "rgba(255,255,255,0.97)",
        boxShadow: "0 40px 90px -30px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.4)",
        color: "#131728",
        opacity: Math.min(1, value),
        transform: `translateY(${((1 - value) * 40).toFixed(2)}px) scale(${(0.94 + 0.06 * value).toFixed(4)})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Img src={staticFile("brand/icon.png")} style={{ width: 52, height: 52, borderRadius: 14 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{note.from}</div>
          <div style={{ fontSize: 19, color: "#7d8198" }}>{note.channel}</div>
        </div>
        <div style={{ fontSize: 19, color: "#7d8198", fontVariantNumeric: "tabular-nums" }}>{note.time}</div>
      </div>
      <div style={{ marginTop: 16, fontSize: 23, lineHeight: 1.45 }}>
        {note.lines.map((line, index) => (
          <div key={index} style={{ fontWeight: index === 0 ? 700 : 500, color: index === 0 ? "#131728" : "#454a62" }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Сцена целиком
 * ------------------------------------------------------------------- */

export function ShowcaseScene({ part, showcase }: { part: ExtPart; showcase: Showcase }) {
  const frame = useCurrentFrame();
  const total = part.durationInFrames;
  // Вход: устройство поднимается из расфокуса; выход — короткая склейка.
  const enter = ease(frame, 0, 16);
  const exit = interpolate(frame, [total - 10, total], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const push = interpolate(frame, [0, total], [0, 1], clamp);
  const phone = showcase.device === "phone";
  const deviceStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: enter * (1 - exit),
    filter: enter < 1 ? `blur(${((1 - enter) * 12).toFixed(2)}px)` : exit > 0 ? `blur(${(exit * 10).toFixed(2)}px)` : undefined,
    transform: `translateY(${((1 - enter) * 60).toFixed(2)}px) scale(${(1 + 0.035 * push + 0.06 * exit).toFixed(4)})`,
    transformOrigin: phone ? "20% 50%" : "35% 50%",
  };
  const railLeft = phone ? 682 : 1300;
  const railWidth = phone ? 560 : 560;
  return (
    <div style={{ position: "absolute", inset: 0, background: STAGE, overflow: "hidden" }}>
      {showcase.photo ? <PhotoBackdrop photo={showcase.photo} accent={showcase.accent} frame={frame} total={total} /> : <OfficeBackdrop accent={showcase.accent} frame={frame} />}
      <div style={deviceStyle}>
        {phone ? (
          <Phone frame={frame}>
            <ScreenImage shots={showcase.shots} part={part} frame={frame} width={PHONE.width - 28} height={PHONE.height - 28} />
          </Phone>
        ) : (
          <Laptop frame={frame}>
            <ScreenImage shots={showcase.shots} part={part} frame={frame} width={LAPTOP.width - 36} height={LAPTOP.screenHeight} />
          </Laptop>
        )}
        {showcase.note ? <Note part={part} frame={frame} note={showcase.note} /> : null}
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - exit }}>
        <PlaceLabel showcase={showcase} frame={frame} left={railLeft} top={phone ? 76 : 150} />
        <Rail showcase={showcase} part={part} frame={frame} left={railLeft} top={phone ? 170 : 244} width={railWidth} />
      </div>
      {/* Виньетка, как у кухонных сцен. */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(125% 95% at 50% 42%, rgba(4,6,14,0) 58%, rgba(4,6,14,0.5) 100%)" }} />
    </div>
  );
}
