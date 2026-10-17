import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CHAPTERS, CHAPTER_FRAMES, FPS } from "./chapters";
import {
  CHAPTER_VOICE_OFFSET,
  CUE_MAX_CHARS,
  HOLD_FROM,
  VOICE_TAIL_SECONDS,
  WHIP_FROM,
  buildTimeline,
  cueGroups,
  holdProgress,
  sceneLocalFor,
  timelineCues,
  toVtt,
  type VoiceTrack,
} from "./narrated-timeline";
import { narratedVideoFor } from "./narrated-video";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const VOICE_DIR = "public/landing/video/voice/ru";

type Segment = { id: string; file: string; text: string; say: string };
const narration = JSON.parse(read("remotion/narration.ru.json")) as { model: string; segments: Segment[] };
const tracks = narration.segments.map(
  (segment) => JSON.parse(read(`${VOICE_DIR}/${segment.file}.json`)) as VoiceTrack & { voiceId: string; model: string; say: string },
);
const timeline = buildTimeline(tracks);
const cues = timelineCues(timeline);

test("сценарий: вступление, шесть глав сцены, финал «Это сетап.»", () => {
  assert.deepEqual(
    narration.segments.map((segment) => segment.id),
    ["intro", ...CHAPTERS.map((chapter) => chapter.id), "outro"],
  );
  assert.match(narration.segments[0].text, /^Сетап — электронные журналы по принципам ХАССП\./);
  assert.equal(narration.segments.at(-1)?.text, "Без бумаги, без паролей и без установки приложений. Это сетап.");
  assert.equal(narration.model, "eleven_multilingual_v2");
  // Ни цен, ни тарифов, ни призыва купить или попробовать.
  for (const segment of narration.segments) {
    assert.doesNotMatch(segment.text, /₽|руб|тариф|цен[аы]|купи|попроб|бесплатн|оформ/i, segment.id);
    assert.equal(segment.say.split(/\s+/).length, segment.text.split(/\s+/).length, `${segment.id}: say и text — одно число слов`);
  }
});

test("голос: весь сценарий озвучен одним голосом дословно, MP3 рядом", () => {
  const voices = new Set(tracks.map((track) => track.voiceId));
  assert.equal(voices.size, 1, "один голос на весь ролик");
  narration.segments.forEach((segment, index) => {
    const track = tracks[index];
    assert.equal(track.id, segment.id);
    assert.equal(track.text, segment.text, `${segment.id}: текст озвучки = сценарий`);
    assert.equal(track.say, segment.say, `${segment.id}: озвучен текущий say`);
    assert.equal(track.model, narration.model);
    assert.equal(track.words.map((word) => word.text).join(" "), segment.text, `${segment.id}: слова таймингов = сценарий`);
    for (let i = 1; i < track.words.length; i += 1) assert.ok(track.words[i].start >= track.words[i - 1].start, `${segment.id}: время слов растёт`);
    assert.ok(track.speechEnd <= track.audioSeconds + 0.05, `${segment.id}: речь внутри MP3`);
    const mp3 = path.join(ROOT, VOICE_DIR, `${segment.file}.mp3`);
    assert.ok(existsSync(mp3) && statSync(mp3).size > 10_000, `${segment.file}.mp3`);
  });
  // Три пробы вступления: два женских голоса и один мужской.
  const samples = readdirSync(path.join(ROOT, ".agent/tasks/landing-video-2026-10/voice-samples")).filter((file) => file.endsWith(".mp3"));
  assert.equal(samples.length, 3);
});

test("глава = max(сцена, голос + 0,5 с): голос не обрезан и не заходит на соседнюю главу", () => {
  assert.equal(timeline.parts.length, 8);
  let from = 0;
  for (const part of timeline.parts) {
    assert.equal(part.from, from, `${part.id}: части идут встык`);
    from += part.durationInFrames;
    const voiceEnd = part.voiceOffset + Math.max(part.voice.audioSeconds, part.voice.speechEnd) * FPS;
    assert.ok(voiceEnd + VOICE_TAIL_SECONDS * FPS <= part.durationInFrames, `${part.id}: после голоса ≥ 0,5 с тишины`);
    if (part.kind === "chapter") {
      const expected = Math.max(CHAPTER_FRAMES, CHAPTER_VOICE_OFFSET + Math.ceil((part.voice.audioSeconds + VOICE_TAIL_SECONDS) * FPS));
      assert.equal(part.durationInFrames, expected, `${part.id}: длина главы`);
    }
  }
  assert.equal(timeline.durationInFrames, from);
  assert.deepEqual(
    timeline.parts.filter((part) => part.kind === "chapter").map((part) => part.chapterIndex),
    [0, 1, 2, 3, 4, 5],
  );
});

test("сцена держит итог главы, склейка — в самом конце", () => {
  for (let frame = 0; frame < CHAPTER_FRAMES; frame += 1) {
    assert.equal(sceneLocalFor(frame, CHAPTER_FRAMES), frame, "глава без запаса — как на главной");
  }
  for (const partFrames of [300, 439]) {
    let previous = -1;
    for (let frame = 0; frame < partFrames; frame += 1) {
      const local = sceneLocalFor(frame, partFrames);
      assert.ok(local >= previous, "время сцены не идёт назад");
      previous = local;
      if (frame <= HOLD_FROM) assert.equal(local, frame, "до итога — как на главной");
      else if (frame < partFrames - (CHAPTER_FRAMES - WHIP_FROM)) assert.ok(local >= HOLD_FROM && local <= WHIP_FROM, `кадр ${frame}: держим итог`);
    }
    assert.equal(sceneLocalFor(partFrames - 1, partFrames), CHAPTER_FRAMES - 1, "последний кадр главы — склейка");
    assert.equal(holdProgress(HOLD_FROM, partFrames), 0);
    assert.ok(holdProgress(partFrames - 1, partFrames) > 0.9);
  }
});

test("субтитры: текст = сценарий, время — из таймингов, не длиннее двух строк", () => {
  for (const part of timeline.parts) {
    const own = cues.filter((cue) => cue.partId === part.id);
    assert.equal(own.map((cue) => cue.text).join(" "), part.voice.text, `${part.id}: реплики складываются в сценарий`);
    const start = (part.from + part.voiceOffset) / FPS;
    assert.equal(own[0].start, Math.round((start + part.voice.words[0].start) * 1000) / 1000, `${part.id}: время первого слова`);
    for (const cue of own) {
      assert.ok(cue.text.length <= CUE_MAX_CHARS, `«${cue.text}» — длинная реплика`);
      assert.ok(cue.start >= part.from / FPS && cue.end <= (part.from + part.durationInFrames) / FPS + 0.001, `${cue.text}: внутри своей части`);
      assert.doesNotMatch(cue.text, /\s[а-яё]{1,2}$/i, `«${cue.text}»: предлог не висит в конце`);
    }
  }
  for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i].start >= cues[i - 1].end - 1e-6, "реплики не накладываются");
  assert.deepEqual(
    cueGroups([{ text: "Раз.", start: 0, end: 1 }, { text: "Два", start: 1, end: 2 }, { text: "три.", start: 2, end: 3 }]).map((group) => group.length),
    [1, 2],
  );
});

test("WebVTT: формат и файл рядом с видео совпадает с таймингами", () => {
  const vtt = toVtt(cues);
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:\d\d\.\d{3} --> 00:00:\d\d\.\d{3}\n/);
  assert.equal(vtt.match(/ --> /g)?.length, cues.length);
  const file = path.join(ROOT, "public/landing/video/qr-tour-ru.vtt");
  if (existsSync(file)) assert.equal(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), vtt, "перерендерите: npm run video:render");
});

test("кнопка видео — только на русской главной и только если MP4 лежит в public/landing/video", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "narrated-video-"));
  try {
    assert.equal(narratedVideoFor("ru", dir), null, "без файла кнопки нет");
    const video = path.join(dir, "landing/video");
    mkdirSync(video, { recursive: true });
    writeFileSync(path.join(video, "qr-tour-ru.mp4"), "x");
    assert.deepEqual(narratedVideoFor("ru", dir), { src: "/landing/video/qr-tour-ru.mp4" });
    writeFileSync(path.join(video, "qr-tour-ru.jpg"), "x");
    writeFileSync(path.join(video, "qr-tour-ru.vtt"), "WEBVTT\n");
    assert.deepEqual(narratedVideoFor("ru", dir), {
      src: "/landing/video/qr-tour-ru.mp4",
      poster: "/landing/video/qr-tour-ru.jpg",
      captions: "/landing/video/qr-tour-ru.vtt",
    });
    assert.equal(narratedVideoFor("en", dir), null, "EN — без озвучки");
    assert.equal(narratedVideoFor("uz", dir), null, "UZ — без озвучки");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const page = read("src/app/page.tsx");
  assert.match(page, /narratedVideoFor\(locale\)/);
  assert.match(page, /<QrPlayer [^>]*video=\{narratedVideo\}/);
  assert.match(read("src/components/landing/qr-player/qr-player.tsx"), /\{video \? \(/, "без видео кнопка не рисуется");
});

test("плеер видео: телефон — нативный полный экран, компьютер — окно, файл не грузится до нажатия", () => {
  const source = read("src/components/landing/qr-player/video-lightbox.tsx");
  assert.match(source, /matchMedia\("\(pointer: coarse\)"\)/);
  assert.match(source, /flushSync\(/, "полный экран — в том же нажатии");
  assert.match(source, /requestFullscreen\(/);
  assert.match(source, /webkitEnterFullscreen\(\)/);
  assert.match(source, /webkitendfullscreen/);
  assert.equal(source.match(/\spreload="none"/g)?.length, 2, "оба <video> — preload=none");
  assert.match(source, /controls\s+playsInline\s+preload="none"/);
  assert.match(source, /poster=\{video\.poster\}/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /aria-label=\{t\("chrome\.close"\)\}/);
  // Клавиши из порталов (окно видео, плеер на весь экран) не управляют роликом на странице.
  assert.match(read("src/components/landing/qr-player/qr-player.tsx"), /if \(!rootRef\.current\?\.contains\(target\)\) return;/);
});

test("рендер: пакеты Remotion 4.0.528 только в devDependencies, сайт их не импортирует", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(pkg.dependencies.remotion, "4.0.528");
  for (const name of ["@remotion/cli", "@remotion/bundler", "@remotion/renderer"]) {
    assert.equal(pkg.devDependencies[name], pkg.dependencies.remotion, name);
    assert.equal(pkg.dependencies[name], undefined, `${name} — не в dependencies`);
  }
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    if (name.startsWith("@remotion/")) assert.equal(version, "4.0.528", name);
  }
  assert.match(pkg.scripts["video:render"], /scripts\/landing-video\/render\.ts/);
  // Цвет для телефонов: yuv420p, ограниченный диапазон BT.709 (не full range yuvj420p).
  const render = read("scripts/landing-video/render.ts");
  assert.match(render, /pixelFormat: "yuv420p"/);
  assert.match(render, /colorSpace: "bt709"/);
  assert.match(render, /codec: "h264"/);
  assert.match(render, /audioCodec: "aac"/);

  // Главная и ролик не тянут пакеты рендера (весь src/ проверен grep — evidence AC9).
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        if (/from\s+["']@remotion\/(cli|bundler|renderer)/.test(read(rel))) offenders.push(rel);
      }
    }
  };
  walk("src/components/landing");
  for (const page of ["src/app/page.tsx", "src/app/en/page.tsx"]) {
    if (/@remotion\/(cli|bundler|renderer)/.test(read(page))) offenders.push(page);
  }
  assert.deepEqual(offenders, []);

  const root = read("remotion/Root.tsx");
  assert.match(root, /id="QrTourNarrated"/);
  const tour = read("remotion/tour.tsx");
  assert.match(tour, /width: 1920, height: 1080, fps: FPS/);
  assert.match(tour, /<SceneFrame /, "главы — та же сцена, что на главной");
  assert.match(tour, /OUTRO_TAGLINE = "ваш электронный HACCP"/);
  // Код без комментариев: в кадре нет QR-наклейки, цен и призывов.
  const code = tour.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /QrSticker|₽|тариф|купи|попроб|бесплатн/i, "финал без QR, цен и призывов");
});
