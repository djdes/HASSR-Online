/**
 * Таймлайн видео «Как работает QR» с голосом (`remotion/`, `npm run video:render`).
 *
 * Вступление → шесть глав той же сцены `SceneFrame`, что на главной →
 * финал. Длина главы — max(сцена, голос + 0,5 с): голос не обрезается и не
 * заходит на соседнюю главу. Если голос длиннее сцены, сцена доходит до
 * итога (`RESULT_SECONDS`) и держит его — камера медленно дожимает бланк, —
 * а склейка «на скорости» остаётся в самом конце главы.
 *
 * Модуль чистый (без Remotion): его же читают скрипт рендера (субтитры
 * `.vtt`) и тесты.
 */
import { CHAPTERS, CHAPTER_FRAMES, CHAPTER_SECONDS, FPS, RESULT_SECONDS, sceneFrame } from "./chapters";

export type VoiceWord = { text: string; start: number; end: number };

/** Озвучка куска сценария: `public/landing/video/voice/<locale>/<file>.json`. */
export type VoiceTrack = {
  id: string;
  text: string;
  audioSeconds: number;
  speechEnd: number;
  words: VoiceWord[];
};

export type TimelinePart = {
  id: string;
  kind: "intro" | "chapter" | "outro";
  chapterIndex?: number;
  /** Первый кадр части в видео. */
  from: number;
  durationInFrames: number;
  /** Кадр от начала части, с которого звучит голос. */
  voiceOffset: number;
  voice: VoiceTrack;
};

export type Timeline = { parts: TimelinePart[]; durationInFrames: number };

/** Реплика субтитров: время в секундах от начала видео. */
export type Cue = { partId: string; start: number; end: number; text: string; words: VoiceWord[] };

/** Тишина после голоса до склейки — 0,5 с. */
export const VOICE_TAIL_SECONDS = 0.5;
/** Голос главы — после «прилёта» новой сцены. */
export const CHAPTER_VOICE_OFFSET = 8;
/** Вступление: сначала логотип, потом голос. */
export const INTRO_VOICE_OFFSET = 14;
export const OUTRO_VOICE_OFFSET = 12;
/** Финал держит логотип ещё 2 с после голоса. */
export const OUTRO_HOLD_SECONDS = 2;

/** Кадр итога сцены (запись уже в бланке) — от него глава держится. */
export const HOLD_FROM = sceneFrame(RESULT_SECONDS);
/** Склейка «на скорости» — последние 0,2 с сцены. */
export const WHIP_FROM = sceneFrame(CHAPTER_SECONDS - 0.2);

const ORDER = ["intro", ...CHAPTERS.map((chapter) => chapter.id), "outro"];

function voiceFrames(track: VoiceTrack): number {
  return Math.ceil((Math.max(track.audioSeconds, track.speechEnd) + VOICE_TAIL_SECONDS) * FPS);
}

/** Длина главы: max(сцена, голос + 0,5 с). */
export function chapterFrames(track: VoiceTrack): number {
  return Math.max(CHAPTER_FRAMES, CHAPTER_VOICE_OFFSET + voiceFrames(track));
}

export function buildTimeline(tracks: VoiceTrack[]): Timeline {
  const ids = tracks.map((track) => track.id);
  if (ids.join() !== ORDER.join()) {
    throw new Error(`Озвучка: ожидались куски ${ORDER.join(", ")}, а есть ${ids.join(", ")}`);
  }
  const parts: TimelinePart[] = [];
  let from = 0;
  tracks.forEach((voice, index) => {
    const kind = index === 0 ? "intro" : index === tracks.length - 1 ? "outro" : "chapter";
    const voiceOffset = kind === "intro" ? INTRO_VOICE_OFFSET : kind === "outro" ? OUTRO_VOICE_OFFSET : CHAPTER_VOICE_OFFSET;
    const durationInFrames =
      kind === "chapter"
        ? chapterFrames(voice)
        : voiceOffset + voiceFrames(voice) + (kind === "outro" ? Math.round((OUTRO_HOLD_SECONDS - VOICE_TAIL_SECONDS) * FPS) : 0);
    parts.push({
      id: voice.id,
      kind,
      ...(kind === "chapter" ? { chapterIndex: index - 1 } : {}),
      from,
      durationInFrames,
      voiceOffset,
      voice,
    });
    from += durationInFrames;
  });
  return { parts, durationInFrames: from };
}

/**
 * Кадр сцены главы для кадра видео: до итога — как на главной, потом
 * итог держится (с долей кадра — камера и зерно живые), последние кадры —
 * склейка. Результат может быть дробным.
 */
export function sceneLocalFor(localFrame: number, partFrames: number): number {
  const extra = Math.max(0, partFrames - CHAPTER_FRAMES);
  if (localFrame <= HOLD_FROM) return localFrame;
  const span = WHIP_FROM - HOLD_FROM;
  if (localFrame < HOLD_FROM + span + extra) return HOLD_FROM + ((localFrame - HOLD_FROM) * span) / (span + extra);
  return Math.min(CHAPTER_FRAMES - 1, localFrame - extra);
}

/** Насколько глава «держит» итог: 0 до итога, 1 к склейке. */
export function holdProgress(localFrame: number, partFrames: number): number {
  const extra = Math.max(0, partFrames - CHAPTER_FRAMES);
  if (extra === 0 || localFrame <= HOLD_FROM) return 0;
  return Math.min(1, (localFrame - HOLD_FROM) / (WHIP_FROM - HOLD_FROM + extra));
}

/* ---------------------------------------------------------------------
 * Субтитры
 * ------------------------------------------------------------------- */

/** Реплика — не длиннее двух строк субтитров. */
export const CUE_MAX_CHARS = 84;
const CUE_LINGER_SECONDS = 0.6;

const joinWords = (words: VoiceWord[]) => words.map((word) => word.text).join(" ");

/** Делит длинное предложение у запятой, двоеточия или тире ближе к середине. */
function splitLong(words: VoiceWord[]): VoiceWord[][] {
  const text = joinWords(words);
  if (text.length <= CUE_MAX_CHARS || words.length < 4) return [words];
  let best = -1;
  let bestScore = Infinity;
  let length = 0;
  for (let index = 0; index < words.length - 1; index += 1) {
    length += words[index].text.length + 1;
    const left = length - 1;
    const right = text.length - length;
    if (left < 18 || right < 18) continue;
    const breaks = /[,:;]$/.test(words[index].text) || words[index].text === "—";
    // Предлог или союз не оставляем висеть в конце строки («…температуру у»).
    if (!breaks && words[index].text.length <= 2) continue;
    const score = Math.abs(left - right) + (breaks ? 0 : 24);
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  if (best < 0) return [words];
  return [...splitLong(words.slice(0, best + 1)), ...splitLong(words.slice(best + 1))];
}

/** Слова куска — на реплики: по предложениям, длинные — пополам. */
export function cueGroups(words: VoiceWord[]): VoiceWord[][] {
  const sentences: VoiceWord[][] = [];
  let current: VoiceWord[] = [];
  for (const word of words) {
    current.push(word);
    if (/[.!?…][»"]?$/.test(word.text)) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length > 0) sentences.push(current);
  return sentences.flatMap(splitLong);
}

/** Все реплики видео со временем от начала ролика. */
export function timelineCues(timeline: Timeline): Cue[] {
  const cues: Cue[] = [];
  for (const part of timeline.parts) {
    const base = (part.from + part.voiceOffset) / FPS;
    const partEnd = (part.from + part.durationInFrames) / FPS;
    const groups = cueGroups(part.voice.words);
    groups.forEach((group, index) => {
      const words = group.map((word) => ({ text: word.text, start: round3(base + word.start), end: round3(base + word.end) }));
      const next = groups[index + 1];
      const limit = next ? base + next[0].start : partEnd;
      cues.push({
        partId: part.id,
        start: words[0].start,
        end: round3(Math.min(limit, words[words.length - 1].end + CUE_LINGER_SECONDS)),
        text: joinWords(group),
        words,
      });
    });
  }
  return cues;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function vttTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/** WebVTT для `<track kind="subtitles">`. */
export function toVtt(cues: Cue[]): string {
  const blocks = cues.map((cue, index) => `${index + 1}\n${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}`);
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}
