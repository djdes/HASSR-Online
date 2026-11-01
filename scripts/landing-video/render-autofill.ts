/**
 * Рендер ролика «Журналы, которые заполняются сами» для /avtozapolnenie:
 *
 *   npm run video:render:autofill
 *
 * 1. Субтитры `public/landing/video/autofill-ru.vtt` — из текстов сцен
 *    (`src/lib/autofill-offer.ts`).
 * 2. Сборка `remotion/index.ts` (webpack Remotion + Tailwind + алиас `@/`).
 * 3. MP4 H.264 1920×1080, 60 с, без звука → `public/landing/video/autofill-ru.mp4`.
 * 4. Постер JPG (кадр с журналом и тревогой датчика) → `autofill-ru.jpg`.
 *
 * Переменные: `VIDEO_CRF` (по умолчанию 30, лимит файла — 8 МБ),
 * `VIDEO_BROWSER` — путь к Chromium/headless shell, если Remotion не может
 * скачать свой. Цвет — `yuv420p`, BT.709, как у ролика про QR.
 *
 * Проверка кадров без полного рендера:
 *   npm run video:render:autofill -- --stills 120,390,700 --out <папка>
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

import { AUTOFILL_VIDEO, autofillTimeline, autofillVtt } from "@/lib/autofill-offer";

import { webpackOverride } from "../../remotion/webpack-override";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/landing/video");
const CRF = Number(process.env.VIDEO_CRF ?? 30);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Постер — сцена с датчиками в момент тревоги: журнал, показания и уведомление. */
function posterFrame(): number {
  const sensors = autofillTimeline().find((scene) => scene.id === "sensors");
  return sensors ? sensors.from + 245 : 0;
}

async function main() {
  console.log("Сборка remotion/index.ts…");
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "remotion/index.ts"),
    webpackOverride,
    publicDir: path.join(ROOT, "public"),
  });
  const browserExecutable = process.env.VIDEO_BROWSER || null;
  const composition = await selectComposition({ serveUrl, id: "AutofillTour", inputProps: {}, browserExecutable });

  const stills = option("stills");
  if (stills) {
    const outDir = path.resolve(option("out") ?? path.join(tmpdir(), "autofill-stills"));
    mkdirSync(outDir, { recursive: true });
    for (const frame of stills.split(",").map(Number)) {
      const output = path.join(outDir, `frame-${String(frame).padStart(5, "0")}.jpg`);
      await renderStill({ composition, serveUrl, inputProps: {}, frame, imageFormat: "jpeg", jpegQuality: 85, output, browserExecutable });
      console.log(`Кадр ${frame}: ${output}`);
    }
    return;
  }

  writeFileSync(path.join(OUT_DIR, `${AUTOFILL_VIDEO.basename}.vtt`), autofillVtt());

  const mp4 = path.join(OUT_DIR, `${AUTOFILL_VIDEO.basename}.mp4`);
  let lastLogged = -1;
  await renderMedia({
    composition,
    serveUrl,
    inputProps: {},
    codec: "h264",
    crf: CRF,
    x264Preset: "slow",
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    muted: true,
    imageFormat: "jpeg",
    jpegQuality: 92,
    outputLocation: mp4,
    browserExecutable,
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 100);
      if (percent >= lastLogged + 10) {
        lastLogged = percent;
        console.log(`Рендер: ${percent}%`);
      }
    },
  });

  await renderStill({
    composition,
    serveUrl,
    inputProps: {},
    frame: posterFrame(),
    imageFormat: "jpeg",
    jpegQuality: 86,
    output: path.join(OUT_DIR, `${AUTOFILL_VIDEO.basename}.jpg`),
    browserExecutable,
  });

  const size = statSync(mp4).size;
  console.log(`MP4: ${(size / 1024 / 1024).toFixed(2)} МБ, ${(composition.durationInFrames / composition.fps).toFixed(1)} с`);
  if (size > AUTOFILL_VIDEO.maxBytes) {
    console.error(`Файл больше ${AUTOFILL_VIDEO.maxBytes / 1024 / 1024} МБ — поднимите VIDEO_CRF (сейчас ${CRF}).`);
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
