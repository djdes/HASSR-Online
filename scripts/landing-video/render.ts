/**
 * Рендер видео «Как работает QR» с голосом для главной:
 *
 *   npm run video:render
 *
 * 1. Субтитры `public/landing/video/qr-tour-ru.vtt` — из таймингов ElevenLabs.
 * 2. Сборка `remotion/index.ts` (webpack Remotion + Tailwind + алиас `@/`).
 * 3. MP4 H.264 + AAC 1920×1080 → `public/landing/video/qr-tour-ru.mp4`.
 * 4. Постер JPG → `public/landing/video/qr-tour-ru.jpg`.
 *
 * Озвучка уже лежит в `public/landing/video/voice/ru/` (scripts/landing-video/voice.mjs):
 * ключ ElevenLabs для рендера не нужен. Переменные: `VIDEO_CRF` (по умолчанию 28:
 * при 26 зерно сцены даёт 16,7 МБ, лимит главной — 15 МБ),
 * `VIDEO_BROWSER` — путь к Chromium, если Remotion не может скачать свой.
 *
 * Цвет — стандартный для веба и телефонов: `yuv420p`, ограниченный диапазон,
 * BT.709 (`colorSpace: "bt709"`). Без него кадры-JPEG дают full range
 * (`yuvj420p`), а с ним iPhone/Safari и часть Android-плееров ошибаются в
 * цвете.
 *
 * Проверка кадров и куска ролика без полного рендера:
 *   npm run video:render -- --stills 120,900,2400 --out <папка>
 *   npm run video:render -- --frames 0-90 --out <файл.mp4>
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

import { buildQrMatrix } from "@/components/landing/qr-player/qr-matrix";
import { buildTimeline, timelineCues, toVtt, type VoiceTrack } from "@/components/landing/qr-player/narrated-timeline";
import { FORMAT_LOCALES } from "@/i18n/locales";

import { webpackOverride } from "../../remotion/webpack-override";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/landing/video");
const BASENAME = "qr-tour-ru";
const MAX_BYTES = 15 * 1024 * 1024;
const CRF = Number(process.env.VIDEO_CRF ?? 28);

type Narration = { segments: { id: string; file: string }[] };

function moscowToday(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const year = pick("year");
  const month = pick("month");
  const monthName = new Intl.DateTimeFormat(FORMAT_LOCALES.ru, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 15)));
  return { day: pick("day"), month, year, daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(), monthLabel: `${monthName} ${year}` };
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const narration = JSON.parse(readFileSync(path.join(ROOT, "remotion/narration.ru.json"), "utf8")) as Narration;
  const tracks = narration.segments.map(
    (segment) => JSON.parse(readFileSync(path.join(OUT_DIR, "voice/ru", `${segment.file}.json`), "utf8")) as VoiceTrack,
  );
  const timeline = buildTimeline(tracks);
  const cues = timelineCues(timeline);
  writeFileSync(path.join(OUT_DIR, `${BASENAME}.vtt`), toVtt(cues));
  console.log(`Субтитры: ${cues.length} реплик, видео ${(timeline.durationInFrames / 30).toFixed(1)} с`);

  const inputProps = {
    qr: await buildQrMatrix("https://wesetup.ru/#qr", "ru"),
    today: moscowToday(new Date()),
  };

  console.log("Сборка remotion/index.ts…");
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "remotion/index.ts"),
    webpackOverride,
    publicDir: path.join(ROOT, "public"),
  });

  const browserExecutable = process.env.VIDEO_BROWSER || null;
  const composition = await selectComposition({ serveUrl, id: "QrTourNarrated", inputProps, browserExecutable });

  const stills = option("stills");
  if (stills) {
    const outDir = path.resolve(option("out") ?? path.join(tmpdir(), "qr-tour-stills"));
    mkdirSync(outDir, { recursive: true });
    for (const frame of stills.split(",").map(Number)) {
      const output = path.join(outDir, `frame-${String(frame).padStart(5, "0")}.jpg`);
      await renderStill({ composition, serveUrl, inputProps, frame, imageFormat: "jpeg", jpegQuality: 85, output, browserExecutable });
      console.log(`Кадр ${frame}: ${output}`);
    }
    return;
  }

  // Кусок ролика для проверки (цвет, звук): в public/ не пишется.
  const frames = option("frames")?.split("-").map(Number) as [number, number] | undefined;
  const mp4 = frames ? path.resolve(option("out") ?? path.join(tmpdir(), "qr-tour-part.mp4")) : path.join(OUT_DIR, `${BASENAME}.mp4`);
  let lastLogged = -1;
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: "h264",
    crf: CRF,
    x264Preset: "slow",
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    audioCodec: "aac",
    audioBitrate: "128k",
    imageFormat: "jpeg",
    jpegQuality: 92,
    outputLocation: mp4,
    ...(frames ? { frameRange: frames } : {}),
    browserExecutable,
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 100);
      if (percent >= lastLogged + 10) {
        lastLogged = percent;
        console.log(`Рендер: ${percent}%`);
      }
    },
  });

  if (frames) {
    console.log(`Кусок ${frames.join("–")}: ${mp4}`);
    return;
  }

  // Постер — вступление: логотип и обе строки титра уже на месте.
  const introPart = timeline.parts[0];
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    frame: introPart.from + introPart.durationInFrames - 18,
    imageFormat: "jpeg",
    jpegQuality: 88,
    output: path.join(OUT_DIR, `${BASENAME}.jpg`),
    browserExecutable,
  });

  const size = statSync(mp4).size;
  console.log(`MP4: ${(size / 1024 / 1024).toFixed(2)} МБ, ${(timeline.durationInFrames / 30).toFixed(1)} с`);
  if (size > MAX_BYTES) {
    console.error(`Файл больше 15 МБ — поднимите VIDEO_CRF (сейчас ${CRF}).`);
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
