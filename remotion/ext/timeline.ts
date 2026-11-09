/**
 * Таймлайн расширенного ролика-презентации (09.11.2026).
 *
 * Тот же принцип, что у `buildTimeline` ролика на главной: вступление →
 * главы → финал, длина главы = max(сцена 8 с, голос + 0,5 с). Отличие —
 * порядок глав задаёт сценарий (`narration.ru.json`), а главы бывают двух
 * видов: «кухня» — прежние сцены `SceneFrame` (по `CHAPTERS`), и «экран» —
 * новые сцены с настоящими экранами сетапа (`SHOWCASES`).
 */
import { CHAPTERS, FPS } from "@/components/landing/qr-player/chapters";
import {
  CONTACTS_SECONDS,
  INTRO_VOICE_OFFSET,
  CHAPTER_VOICE_OFFSET,
  OUTRO_HOLD_SECONDS,
  OUTRO_VOICE_OFFSET,
  TAGLINE_PAUSE_SECONDS,
  VOICE_TAIL_SECONDS,
  chapterFrames,
  type TimelinePart,
  type VoiceTrack,
} from "@/components/landing/qr-player/narrated-timeline";

export type ExtPart = TimelinePart & {
  /** Сцена-экран (id из `SHOWCASES`); у кухонных глав — undefined. */
  showcase?: string;
  /** Номер главы на плашке (1, 2, …) по порядку в ролике. */
  number?: number;
};

export type ExtTimeline = { parts: ExtPart[]; durationInFrames: number };

const audioFrames = (track: VoiceTrack) => Math.ceil(Math.max(track.audioSeconds, track.speechEnd) * FPS);
const voiceFrames = (track: VoiceTrack) => Math.ceil((Math.max(track.audioSeconds, track.speechEnd) + VOICE_TAIL_SECONDS) * FPS);

/** Экранной сцене — на секунду больше воздуха: зритель успевает рассмотреть экран. */
export const SHOWCASE_EXTRA_FRAMES = FPS;

export function buildExtTimeline(tracks: VoiceTrack[], showcaseIds: readonly string[]): ExtTimeline {
  if (tracks[0]?.id !== "intro") throw new Error("Сценарий: первый кусок — intro");
  if (tracks.at(-2)?.id !== "outro" || tracks.at(-1)?.id !== "outroTagline") throw new Error("Сценарий: в конце — outro и outroTagline");
  const parts: ExtPart[] = [];
  let from = 0;
  const push = (part: Omit<ExtPart, "from" | "voice" | "voiceOffset">) => {
    parts.push({ ...part, from, voice: part.voices[0].track, voiceOffset: part.voices[0].offset });
    from += part.durationInFrames;
  };
  const intro = tracks[0];
  push({ id: intro.id, kind: "intro", durationInFrames: INTRO_VOICE_OFFSET + voiceFrames(intro), voices: [{ track: intro, offset: INTRO_VOICE_OFFSET }] });
  tracks.slice(1, -2).forEach((track, index) => {
    const chapterIndex = CHAPTERS.findIndex((chapter) => chapter.id === track.id);
    const isShowcase = showcaseIds.includes(track.id);
    if (chapterIndex < 0 && !isShowcase) throw new Error(`Сценарий: у куска ${track.id} нет сцены`);
    push({
      id: track.id,
      kind: "chapter",
      chapterIndex: chapterIndex < 0 ? undefined : chapterIndex,
      showcase: isShowcase ? track.id : undefined,
      number: index + 1,
      durationInFrames: chapterFrames(track) + (isShowcase ? SHOWCASE_EXTRA_FRAMES : 0),
      voices: [{ track, offset: CHAPTER_VOICE_OFFSET }],
    });
  });
  const outro = tracks[tracks.length - 2];
  const tagline = tracks[tracks.length - 1];
  const taglineOffset = OUTRO_VOICE_OFFSET + audioFrames(outro) + Math.round(TAGLINE_PAUSE_SECONDS * FPS);
  push({
    id: outro.id,
    kind: "outro",
    durationInFrames: taglineOffset + audioFrames(tagline) + Math.round((OUTRO_HOLD_SECONDS + CONTACTS_SECONDS) * FPS),
    voices: [
      { track: outro, offset: OUTRO_VOICE_OFFSET },
      { track: tagline, offset: taglineOffset },
    ],
  });
  return { parts, durationInFrames: from };
}
