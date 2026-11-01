import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  AUTOFILL_CLIP,
  AUTOFILL_CLIP_SCENES,
  AUTOFILL_FPS,
  AUTOFILL_SCENES,
  autofillClipBasename,
  autofillClipCaption,
  autofillScene,
} from "@/lib/autofill-offer";

/**
 * Вертикальные ролики для соцсетей — те же сцены, что в большом ролике
 * (`.agent/tasks/growth-stage3-2026-11/spec.md`, AC5).
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("вертикальные ролики «Журналы, которые заполняются сами»", () => {
  it("1080×1920, 15 с: сцена и концовка с адресом", () => {
    assert.equal(AUTOFILL_CLIP.width, 1080);
    assert.equal(AUTOFILL_CLIP.height, 1920);
    assert.equal(AUTOFILL_CLIP.durationSeconds, 15);
    assert.equal(AUTOFILL_CLIP.sceneFrames + AUTOFILL_CLIP.outroFrames, AUTOFILL_CLIP.durationInFrames);
    assert.equal(AUTOFILL_CLIP.durationInFrames, AUTOFILL_CLIP.durationSeconds * AUTOFILL_FPS);
  });

  it("по ролику на каждый источник данных; сцена успевает доиграть до концовки", () => {
    const sources = AUTOFILL_SCENES.filter((scene) => scene.chapter !== null).map((scene) => scene.id);
    assert.deepEqual([...AUTOFILL_CLIP_SCENES], sources);
    for (const id of AUTOFILL_CLIP_SCENES) {
      assert.ok(autofillScene(id).frames <= AUTOFILL_CLIP.sceneFrames, `${id}: ${autofillScene(id).frames} кадров`);
    }
    assert.deepEqual(
      AUTOFILL_CLIP_SCENES.map(autofillClipBasename),
      ["autofill-clip-01-sensors", "autofill-clip-02-invoices", "autofill-clip-03-mercury", "autofill-clip-04-photo", "autofill-clip-05-schedule"],
    );
  });

  it("текст к публикации — из текстов сцены и адреса концовки", () => {
    const caption = autofillClipCaption("sensors");
    const scene = autofillScene("sensors");
    assert.ok(caption.startsWith(`${scene.title}. ${scene.sub}\n\n`));
    assert.match(caption, /https:\/\/wesetup\.ru\/avtozapolnenie/);
    assert.equal(autofillScene("outro").sub, "wesetup.ru/avtozapolnenie");
  });

  it("Remotion: композиции по списку сцен, сцена и концовка — из тех же данных", () => {
    const root = read("remotion/Root.tsx");
    assert.match(root, /AUTOFILL_CLIP_SCENES\.map\(\(sceneId\) => \(/);
    assert.match(root, /id=\{`AutofillClip-\$\{sceneId\}`\}/);
    assert.match(root, /durationInFrames=\{AUTOFILL_CLIP\.durationInFrames\}/);
    const tour = read("remotion/autofill-tour.tsx");
    assert.match(tour, /<Scene scene=\{\{ \.\.\.autofillScene\(sceneId\), frames: AUTOFILL_CLIP\.sceneFrames \}\} \/>/);
    assert.match(tour, /<OutroScene scene=\{\{ \.\.\.autofillScene\("outro"\), frames: AUTOFILL_CLIP\.outroFrames \}\} \/>/);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts["video:render:clips"], "tsx scripts/landing-video/render-clips.ts");
  });
});
