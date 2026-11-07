import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { signupChannel } from "@/lib/signup-channel";
import {
  AUTOFILL_CLIP,
  AUTOFILL_CLIP_PLATFORMS,
  AUTOFILL_CLIP_SCENES,
  AUTOFILL_FPS,
  AUTOFILL_SCENES,
  autofillClipBasename,
  autofillClipCaption,
  autofillClipUrl,
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

  it("текст к публикации — из текстов сцены и адреса концовки, по площадке", () => {
    const scene = autofillScene("sensors");
    const vk = autofillClipCaption("sensors", "vk");
    assert.ok(vk.startsWith(`${scene.title}. ${scene.sub}\n\n`));
    assert.match(vk, /#ХАССП/);
    const telegram = autofillClipCaption("sensors", "telegram");
    assert.ok(telegram.startsWith(`${scene.title}\n\n${scene.sub}\n\n`));
    assert.match(telegram, /https:\/\/wesetup\.ru\/avtozapolnenie\?utm_source=telegram&utm_medium=clip&utm_campaign=autofill-sensors/);
    assert.equal(autofillScene("outro").sub, "wesetup.ru/avtozapolnenie");
  });

  it("ссылки с метками: воронка видит VK, Telegram и MAX как свои каналы", () => {
    for (const platform of AUTOFILL_CLIP_PLATFORMS) {
      for (const id of AUTOFILL_CLIP_SCENES) {
        const url = new URL(autofillClipUrl(id, platform));
        assert.equal(url.pathname, "/avtozapolnenie");
        const snapshot = {
          place: "",
          landing: url.pathname,
          referrer: "",
          utmSource: url.searchParams.get("utm_source") ?? "",
          utmMedium: url.searchParams.get("utm_medium") ?? "",
          utmCampaign: url.searchParams.get("utm_campaign") ?? "",
        };
        assert.equal(signupChannel(snapshot), platform);
        assert.equal(snapshot.utmCampaign, `autofill-${id}`);
      }
    }
  });

  it("план публикации: даты пн/ср/пт с 9 ноября, тексты — те же, что из кода", () => {
    const plan = read("docs/clips-publication-plan.md");
    for (const date of ["пн, 9 ноября", "ср, 11 ноября", "пт, 13 ноября", "пн, 16 ноября", "ср, 18 ноября"]) {
      assert.ok(plan.includes(date), date);
    }
    for (const id of AUTOFILL_CLIP_SCENES) {
      for (const platform of ["vk", "telegram"] as const) {
        assert.ok(plan.includes(autofillClipCaption(id, platform)), `${id}/${platform}`);
      }
    }
    assert.match(read("scripts/landing-video/render-clips.ts"), /\$\{basename\}-\$\{platform\}\.txt/);
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
