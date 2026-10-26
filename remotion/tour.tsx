import { Mail, Phone } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Html5Audio,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

import { CHAPTERS, FPS } from "@/components/landing/qr-player/chapters";
import {
  CONTACTS_SECONDS,
  buildTimeline,
  holdProgress,
  sceneLocalFor,
  timelineCues,
  type Cue,
  type TimelinePart,
  type VoiceTrack,
} from "@/components/landing/qr-player/narrated-timeline";
import type { QrMatrix } from "@/components/landing/qr-player/qr-sticker";
import { SceneAssets, SceneFrame, STAGE_BACKGROUND, type SceneDay } from "@/components/landing/qr-player/scene";
import { pickMessages, type Messages } from "@/i18n/messages";
import ru from "@/i18n/messages/ru.json";

import narration from "./narration.ru.json";
import intro from "../public/landing/video/voice/ru/00-intro.json";
import fridge from "../public/landing/video/voice/ru/01-fridge.json";
import locker from "../public/landing/video/voice/ru/02-locker.json";
import uv from "../public/landing/video/voice/ru/03-uv.json";
import forgot from "../public/landing/video/voice/ru/05-forgot.json";
import sensor from "../public/landing/video/voice/ru/06-sensor.json";
import outro from "../public/landing/video/voice/ru/07-outro.json";
import outroTagline from "../public/landing/video/voice/ru/08-outro-tagline.json";

/**
 * Видео «Как работает QR» с голосом: та же композиция `SceneFrame`, что на
 * главной, плюс вступление, финал, голос ElevenLabs и субтитры по его
 * таймингам. Таймлайн — `narrated-timeline.ts` (глава = max(сцена,
 * голос + 0,5 с), итог главы держится до склейки). Финал — крупный
 * логотип «сетап» и подпись, без цен и призыва купить.
 *
 * Приёмы: слова титров и субтитров проявляются в момент, когда их
 * произносит голос (подъём + расфокус → резкость), логотип собирается из
 * расфокуса, между главами — склейка «на скорости» самой сцены, пока глава
 * держит итог — медленный наезд на бланк.
 */

export const VIDEO = { width: 1920, height: 1080, fps: FPS } as const;
/** Контакты в ролике: номер — в углу всего ролика и крупно в конце (по нему нас находят в MAX и Telegram). */
export const CONTACTS = { phone: "+7 925 305-80-77", email: "admin@wesetup.ru" } as const;
const CONTACTS_FRAMES = Math.round(CONTACTS_SECONDS * FPS);
export const TRACKS: VoiceTrack[] = [intro, fridge, locker, uv, forgot, sensor, outro, outroTagline];
export const TIMELINE = buildTimeline(TRACKS);
export const CUES: Cue[] = timelineCues(TIMELINE);

const FILES = Object.fromEntries(narration.segments.map((segment) => [segment.id, segment.file]));
/** Усиление клипа (дБ): «Это сетап.» в конце фразы голос произносит тише — выравниваем до средней громкости ролика. */
const GAIN = Object.fromEntries(narration.segments.map((segment) => [segment.id, "gainDb" in segment ? segment.gainDb : 0]));
// Те же пространства сообщений, что у ролика на главной (`DomainMessagesBoundary`).
const MESSAGES = pickMessages(ru as Messages, ["qrPlayer", "qrScene", "journals", "hygiene"]);
const FONT = "Manrope, 'Segoe UI', system-ui, sans-serif";
const INK = "#05070f";
/** Акцент на ключевом слове — светлый индиго → фиолетовый (дизайн-система). */
const ACCENT_TEXT: CSSProperties = {
  backgroundImage: "linear-gradient(100deg, #aab4ff 0%, #8b97ff 45%, #b9a8ff 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

export type QrTourProps = { qr: QrMatrix; today: SceneDay };

/** Фото мест — заранее и целиком: кадр не снимается, пока они не готовы. */
function usePreloadedPhotos() {
  const [handle] = useState(() => delayRender("Фото мест ролика"));
  useEffect(() => {
    Promise.all(
      CHAPTERS.map((chapter) => {
        const image = new Image();
        image.src = staticFile(chapter.photo.replace(/^\//, ""));
        return image.decode().catch(() => undefined);
      }),
    ).then(() => continueRender(handle));
  }, [handle]);
}

const asset = (src: string) => (src.startsWith("/") ? staticFile(src.slice(1)) : src);

export const QrTourNarrated: React.FC<QrTourProps> = ({ qr, today }) => {
  usePreloadedPhotos();
  return (
    <AbsoluteFill style={{ background: INK, fontFamily: FONT }}>
      <NextIntlClientProvider locale="ru" messages={MESSAGES} timeZone="Europe/Moscow">
        <SceneAssets.Provider value={asset}>
          {TIMELINE.parts.map((part) => (
            <Sequence key={part.id} from={part.from} durationInFrames={part.durationInFrames} name={part.id}>
              {part.kind === "intro" ? <IntroCard part={part} /> : null}
              {part.kind === "chapter" ? <ChapterPart part={part} qr={qr} today={today} /> : null}
              {part.kind === "outro" ? <OutroCard part={part} /> : null}
              {part.voices.map((voice) => (
                <Sequence key={voice.track.id} from={voice.offset} name={`голос ${voice.track.id}`}>
                  <Html5Audio src={staticFile(`landing/video/voice/ru/${FILES[voice.track.id]}.mp3`)} volume={10 ** ((GAIN[voice.track.id] ?? 0) / 20)} />
                </Sequence>
              ))}
            </Sequence>
          ))}
          <Captions />
          <CornerPhone />
        </SceneAssets.Provider>
      </NextIntlClientProvider>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------------
 * Общие приёмы
 * ------------------------------------------------------------------- */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Кадр части, с которого голос произносит слово `index`. */
function wordAt(part: TimelinePart, index: number): number {
  const word = part.voice.words[Math.min(index, part.voice.words.length - 1)];
  return part.voiceOffset + Math.round(word.start * FPS);
}

/** Номер слова, с которого начинается следующее предложение. */
function sentenceAfter(part: TimelinePart, from = 0): number {
  const words = part.voice.words;
  for (let index = from; index < words.length; index += 1) {
    if (/[.!?…][»"]?$/.test(words[index].text)) return index + 1;
  }
  return words.length;
}

/** Проявление: подъём + расфокус → резкость. */
function reveal(frame: number, at: number, duration = 12, lift = 22, blur = 10): CSSProperties {
  const value = interpolate(frame, [at, at + duration], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return {
    opacity: value,
    transform: `translateY(${((1 - value) * lift).toFixed(2)}px)`,
    filter: value < 1 ? `blur(${((1 - value) * blur).toFixed(2)}px)` : undefined,
  };
}

/** Слова строки появляются в такт голосу. */
function SpokenLine({ part, frame, words, from, style }: { part: TimelinePart; frame: number; words: string[]; from: number; style?: CSSProperties }) {
  return (
    <div style={style}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} style={{ display: "inline-block", whiteSpace: "pre", ...reveal(frame, wordAt(part, from + index) - 4) }}>
          {word.startsWith("*") ? <span style={ACCENT_TEXT}>{word.slice(1)}</span> : word}
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
}

/** Фон вступления и финала — «тёмный герой» дизайн-системы. */
function HeroBackdrop({ frame, children }: { frame: number; children?: ReactNode }) {
  const drift = (speed: number, amount: number) => Math.sin((frame / FPS) * speed) * amount;
  const blob = (style: CSSProperties): CSSProperties => ({ position: "absolute", borderRadius: "9999px", ...style });
  return (
    <AbsoluteFill style={{ background: "#0b1024", overflow: "hidden" }}>
      <div style={blob({ left: -180 + drift(0.35, 40), top: -200 + drift(0.27, 30), width: 820, height: 820, background: "#5566f6", opacity: 0.4, filter: "blur(160px)" })} />
      <div style={blob({ right: -220 + drift(0.3, 50), bottom: -300 + drift(0.22, 40), width: 900, height: 900, background: "#7a5cff", opacity: 0.3, filter: "blur(180px)" })} />
      <div style={blob({ left: 640 + drift(0.25, 60), top: 520 + drift(0.31, 30), width: 560, height: 560, background: "#3d4efc", opacity: 0.22, filter: "blur(140px)" })} />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(80% 70% at 50% 45%, black, transparent)",
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

function Wordmark({ height, style }: { height: number; style?: CSSProperties }) {
  return <Img src={staticFile("brand/wordmark.png")} style={{ display: "block", height, width: "auto", ...style }} />;
}

/** Логотип собирается из расфокуса пружиной. */
function logoIn(frame: number, at: number, config = { damping: 16, mass: 0.9, stiffness: 110 }): { value: number; style: CSSProperties } {
  const value = spring({ frame: frame - at, fps: FPS, config });
  const shown = Math.min(1, Math.max(0, value));
  return {
    value: shown,
    style: {
      opacity: shown,
      transform: `scale(${(0.88 + 0.12 * value).toFixed(4)})`,
      filter: shown < 0.995 ? `blur(${((1 - shown) * 18).toFixed(2)}px)` : undefined,
    },
  };
}

/* ---------------------------------------------------------------------
 * Вступление: логотип → «Электронные журналы по принципам ХАССП» в такт
 * голосу → «Смотрите, как это работает на кухне» → проезд «сквозь» титр.
 * ------------------------------------------------------------------- */

function IntroCard({ part }: { part: TimelinePart }) {
  const frame = useCurrentFrame();
  const logo = logoIn(frame, 0, { damping: 200, mass: 1, stiffness: 120 }).style;
  const out = interpolate(frame, [part.durationInFrames - 14, part.durationInFrames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const second = sentenceAfter(part);
  // «Сетап — электронные…»: титр начинается со второго слова после тире.
  const titleFrom = part.voice.words.findIndex((word, index) => index > 0 && word.text !== "—");
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${(1 + 0.06 * out).toFixed(4)})` }}>
      <HeroBackdrop frame={frame} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: "#ffffff", textAlign: "center" }}>
        <div style={logo}>
          <Wordmark height={150} />
        </div>
        <SpokenLine
          part={part}
          frame={frame}
          from={titleFrom}
          words={["Электронные", "журналы", "по", "принципам", "*ХАССП"]}
          style={{ marginTop: 60, fontSize: 68, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.12, maxWidth: 1500 }}
        />
        <SpokenLine
          part={part}
          frame={frame}
          from={second}
          words={["Смотрите,", "как", "это", "работает", "на", "кухне"]}
          style={{ marginTop: 28, fontSize: 38, fontWeight: 500, color: "rgba(255,255,255,0.74)" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------------
 * Финал: «Без бумаги, без паролей и без установки приложений.» в такт
 * голосу → на «сетап» — крупный логотип и подпись. Без цен и призывов.
 * ------------------------------------------------------------------- */

export const OUTRO_TAGLINE = "Ваш электронный ХАССП";

function OutroCard({ part }: { part: TimelinePart }) {
  const frame = useCurrentFrame();
  const words = part.voice.words;
  const firstSentenceEnd = sentenceAfter(part);
  // Логотип — на «сетап» из отдельного клипа «Это сетап.» (после паузы).
  const tagline = part.voices[part.voices.length - 1];
  const logoAt = tagline.offset + Math.round(tagline.track.words[tagline.track.words.length - 1].start * FPS) - 4;
  const { value: logoValue, style: logo } = logoIn(frame, logoAt);
  const fadeIn = interpolate(frame, [0, 14], [0, 1], clamp);
  const lift = interpolate(frame, [logoAt - 8, logoAt + 16], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const caption = interpolate(frame, [logoAt + 20, logoAt + 44], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  // Последние секунды — контакты: логотип с подписью уезжает наверх, «Без бумаги…» гаснет.
  const contactsAt = part.durationInFrames - CONTACTS_FRAMES;
  const toContacts = interpolate(frame, [contactsAt, contactsAt + 24], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <HeroBackdrop frame={frame + 400}>
        {/* Мягкое свечение за логотипом. */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 1100, height: 520, borderRadius: 9999, background: "radial-gradient(closest-side, rgba(85,102,246,0.55), rgba(85,102,246,0))", opacity: logoValue * 0.9, transform: `translateY(40px) scale(${(0.8 + 0.2 * logoValue).toFixed(4)})` }} />
        </AbsoluteFill>
      </HeroBackdrop>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          textAlign: "center",
          transform: `translateY(${(-262 * toContacts).toFixed(2)}px) scale(${(1 - 0.3 * toContacts).toFixed(4)})`,
        }}
      >
        <div style={{ transform: `translateY(${(-70 * lift).toFixed(2)}px)`, opacity: (1 - 0.45 * lift) * (1 - toContacts) }}>
          <SpokenLine
            part={part}
            frame={frame}
            from={0}
            words={words.slice(0, firstSentenceEnd).map((word) => word.text)}
            style={{ fontSize: 58, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.18, maxWidth: 1500 }}
          />
        </div>
        <div style={{ marginTop: 64, transform: `translateY(${(-36 * lift).toFixed(2)}px)` }}>
          <div style={logo}>
            <Wordmark height={220} />
          </div>
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 38,
            fontWeight: 500,
            color: "rgba(255,255,255,0.78)",
            letterSpacing: `${(0.14 - 0.1 * caption).toFixed(3)}em`,
            opacity: caption,
            transform: `translateY(${((1 - caption) * 14 - 36 * lift).toFixed(2)}px)`,
          }}
        >
          {OUTRO_TAGLINE}
        </div>
      </AbsoluteFill>
      <ContactsCard frame={frame} at={contactsAt + 10} />
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------------
 * Контакты: по номеру нас находят в MAX и Telegram, ниже — почта.
 * Строки проявляются по очереди, как титры.
 * ------------------------------------------------------------------- */

function ContactsCard({ frame, at }: { frame: number; at: number }) {
  const card = reveal(frame, at, 16, 40, 14);
  const icon: CSSProperties = { display: "block", width: 104, height: 104 };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 486, color: "#ffffff", textAlign: "center" }}>
      <div
        style={{
          ...card,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
          padding: "42px 76px 48px",
          borderRadius: 48,
          background: "rgba(255,255,255,0.06)",
          boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.12), 0 50px 110px -50px rgba(0,0,0,0.8)",
        }}
      >
        <div style={{ ...reveal(frame, at + 6), fontSize: 34, fontWeight: 500, color: "rgba(255,255,255,0.76)" }}>
          Найдите нас в <span style={ACCENT_TEXT}>MAX</span> и <span style={ACCENT_TEXT}>Telegram</span> по номеру
        </div>
        <div style={{ ...reveal(frame, at + 12), display: "flex", alignItems: "center", gap: 26 }}>
          <Img src={staticFile("landing/video/messengers/max.png")} style={{ ...icon, borderRadius: 26 }} />
          <Img src={staticFile("landing/video/messengers/telegram.svg")} style={icon} />
          <div style={{ marginLeft: 14, fontSize: 96, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {CONTACTS.phone}
          </div>
        </div>
        <div style={{ ...reveal(frame, at + 18), display: "flex", alignItems: "center", gap: 18, fontSize: 52, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>
          <Mail size={46} strokeWidth={2} color="#aab4ff" />
          {CONTACTS.email}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** Номер — в правом нижнем углу всего ролика; на экране контактов его сменяет крупный. */
function CornerPhone() {
  const frame = useCurrentFrame();
  const outro = TIMELINE.parts[TIMELINE.parts.length - 1];
  const contactsAt = outro.from + outro.durationInFrames - CONTACTS_FRAMES;
  const shown = Math.min(interpolate(frame, [10, 26], [0, 1], clamp), interpolate(frame, [contactsAt - 4, contactsAt + 10], [1, 0], clamp));
  if (shown <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        bottom: 40,
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 52,
        padding: "0 22px 0 18px",
        borderRadius: 9999,
        background: "rgba(5,7,15,0.62)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), 0 18px 40px -24px rgba(0,0,0,0.8)",
        color: "rgba(255,255,255,0.94)",
        fontSize: 24,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        opacity: shown,
      }}
    >
      <Phone size={20} strokeWidth={2.2} color="#aab4ff" />
      {CONTACTS.phone}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * Главы
 * ------------------------------------------------------------------- */

function ChapterPart({ part, qr, today }: { part: TimelinePart; qr: QrMatrix; today: SceneDay }) {
  const frame = useCurrentFrame();
  const chapterIndex = part.chapterIndex ?? 0;
  const chapter = CHAPTERS[chapterIndex];
  const local = sceneLocalFor(frame, part.durationInFrames);
  // Пока глава держит итог — медленный наезд на бланк.
  const hold = Easing.inOut(Easing.sin)(holdProgress(frame, part.durationInFrames));
  // Первая глава проявляется после вступления, остальные склеивает сама сцена.
  const fadeIn = chapterIndex === 0 ? interpolate(frame, [0, 12], [0, 1], clamp) : 1;
  // Название главы — титр на первые секунды: дальше сцена сама показывает
  // уведомления в правом верхнем углу.
  const chip = interpolate(frame, [8, 22, 128, 144], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const label = (ru.qrScene.chapters as Record<string, string>)[`${chapter.id}Chip`];
  return (
    <AbsoluteFill style={{ opacity: fadeIn, background: STAGE_BACKGROUND }}>
      <AbsoluteFill className="@container" style={{ transform: `scale(${(1 + 0.045 * hold).toFixed(4)})` }}>
        <SceneFrame frame={chapter.from + local} fridgeTemp={4} bodyTemp={36.6} today={today} qr={qr} />
      </AbsoluteFill>
      {/* Номер и название главы — как вкладка над роликом на главной.
          Справа сверху: слева в кадре телефон со строкой состояния. */}
      <div
        style={{
          position: "absolute",
          right: 48,
          top: 44,
          display: "flex",
          alignItems: "center",
          gap: 14,
          height: 60,
          padding: "0 28px 0 12px",
          borderRadius: 9999,
          background: "rgba(5,7,15,0.62)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), 0 18px 40px -24px rgba(0,0,0,0.8)",
          color: "#ffffff",
          fontSize: 27,
          fontWeight: 600,
          opacity: chip,
          transform: `translateX(${((1 - chip) * 18).toFixed(2)}px)`,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            width: 38,
            height: 38,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9999,
            background: chapter.accentSoft,
            color: chapter.accent,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {chapterIndex + 1}
        </span>
        {label}
      </div>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------------
 * Субтитры в кадре: реплика целиком, слово светлеет, когда его
 * произносит голос. На вступлении и финале их заменяют титры.
 * ------------------------------------------------------------------- */

function Captions() {
  const frame = useCurrentFrame();
  const part = TIMELINE.parts.find((item) => frame >= item.from && frame < item.from + item.durationInFrames);
  if (!part || part.kind !== "chapter") return null;
  const now = frame / FPS;
  const cue = CUES.find((item) => item.partId === part.id && now >= item.start - 0.1 && now < item.end);
  if (!cue) return null;
  const appear = interpolate(now, [cue.start - 0.1, cue.start + 0.08], [0, 1], clamp);
  const leave = interpolate(now, [cue.end - 0.14, cue.end], [1, 0], clamp);
  const shown = Math.min(appear, leave);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 54, pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1240,
          padding: "16px 34px 18px",
          borderRadius: 24,
          background: "rgba(8,11,24,0.88)",
          boxShadow: "0 18px 50px -20px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.08)",
          color: "#ffffff",
          fontSize: 44,
          fontWeight: 600,
          lineHeight: 1.3,
          letterSpacing: "-0.005em",
          textAlign: "center",
          textWrap: "balance",
          opacity: shown,
          transform: `translateY(${((1 - appear) * 12).toFixed(2)}px)`,
        }}
      >
        {cue.words.map((word, index) => {
          const lit = interpolate(now, [word.start - 0.06, word.start + 0.08], [0, 1], clamp);
          return (
            <span key={`${word.text}-${index}`} style={{ color: `rgba(255,255,255,${(0.5 + 0.5 * lit).toFixed(3)})` }}>
              {word.text}
              {index < cue.words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
