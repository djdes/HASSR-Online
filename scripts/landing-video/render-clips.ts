/**
 * Вертикальные ролики для соцсетей (VK Клипы, Reels, Shorts):
 *
 *   npm run video:render:clips -- --out <папка>
 *
 * По ролику на источник данных (`AUTOFILL_CLIP_SCENES` в
 * `src/lib/autofill-offer.ts`): MP4 H.264 1080×1920, 15 с, без звука,
 * обложка JPG и текст к публикации TXT. Файлы — владельцу для публикации:
 * на сайт и в репозиторий они не кладутся, поэтому папка по умолчанию —
 * временная (`<tmp>/wesetup-clips`).
 *
 * Ключи: `--only sensors,photo` — часть роликов; `--stills 60,300,400` —
 * только кадры для проверки. Переменные — как у `render-autofill.ts`:
 * `VIDEO_CRF` (по умолчанию 26), `VIDEO_BROWSER`.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

import {
  AUTOFILL_CLIP,
  AUTOFILL_CLIP_SCENES,
  autofillClipBasename,
  autofillClipCaption,
  type AutofillClipSceneId,
} from "@/lib/autofill-offer";

import { webpackOverride } from "../../remotion/webpack-override";

const ROOT = process.cwd();
const CRF = Number(process.env.VIDEO_CRF ?? 26);
/** Обложка — сцена в собранном виде, перед концовкой. */
const COVER_FRAME = AUTOFILL_CLIP.sceneFrames - 30;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectedScenes(): AutofillClipSceneId[] {
  const only = option("only");
  if (!only) return [...AUTOFILL_CLIP_SCENES];
  const wanted = only.split(",").map((item) => item.trim());
  const unknown = wanted.filter((item) => !(AUTOFILL_CLIP_SCENES as readonly string[]).includes(item));
  if (unknown.length > 0) throw new Error(`Нет таких роликов: ${unknown.join(", ")}. Есть: ${AUTOFILL_CLIP_SCENES.join(", ")}`);
  return wanted as AutofillClipSceneId[];
}

async function main() {
  const outDir = path.resolve(option("out") ?? path.join(tmpdir(), "wesetup-clips"));
  mkdirSync(outDir, { recursive: true });
  const scenes = selectedScenes();

  console.log("Сборка remotion/index.ts…");
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "remotion/index.ts"),
    webpackOverride,
    publicDir: path.join(ROOT, "public"),
  });
  const browserExecutable = process.env.VIDEO_BROWSER || null;
  const stills = option("stills");

  for (const sceneId of scenes) {
    const inputProps = { sceneId };
    const composition = await selectComposition({ serveUrl, id: `AutofillClip-${sceneId}`, inputProps, browserExecutable });
    const basename = autofillClipBasename(sceneId);

    if (stills) {
      for (const frame of stills.split(",").map(Number)) {
        const output = path.join(outDir, `${basename}-frame-${String(frame).padStart(3, "0")}.jpg`);
        await renderStill({ composition, serveUrl, inputProps, frame, imageFormat: "jpeg", jpegQuality: 85, output, browserExecutable });
        console.log(`Кадр ${frame}: ${output}`);
      }
      continue;
    }

    const mp4 = path.join(outDir, `${basename}.mp4`);
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
      muted: true,
      imageFormat: "jpeg",
      jpegQuality: 92,
      outputLocation: mp4,
      browserExecutable,
      onProgress: ({ progress }) => {
        const percent = Math.floor(progress * 100);
        if (percent >= lastLogged + 25) {
          lastLogged = percent;
          console.log(`${basename}: ${percent}%`);
        }
      },
    });
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      frame: COVER_FRAME,
      imageFormat: "jpeg",
      jpegQuality: 88,
      output: path.join(outDir, `${basename}.jpg`),
      browserExecutable,
    });
    writeFileSync(path.join(outDir, `${basename}.txt`), `${autofillClipCaption(sceneId)}\n`);
    const seconds = composition.durationInFrames / composition.fps;
    console.log(`${basename}.mp4: ${(statSync(mp4).size / 1024 / 1024).toFixed(2)} МБ, ${seconds} с, ${composition.width}×${composition.height}`);
  }
  console.log(`Готово: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
