import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { POSTER_DIR, defaultPosterTexts, posterTextsKey } from "@/lib/mailing/kinds/poster-shared";

import {
  PosterError,
  composePoster,
  posterBackgroundPrompt,
  posterBackgroundStatus,
  renderPosterImage,
  twoLines,
} from "./poster-image.server";

const JOB = "4451e2e2-d236-4b04-9194-b7de0d4d72c4";
const BG = `bg-${JOB}.jpg`;

/** Фон-заглушка: тёмный градиент, как у настоящей генерации. */
async function fakeBackground(): Promise<Buffer> {
  const canvas = createCanvas(1122, 1402);
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 1402);
  g.addColorStop(0, "#0b1024");
  g.addColorStop(1, "#3848c7");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1122, 1402);
  return canvas.encode("jpeg", 80);
}

describe("постер письма: сборка картинки", () => {
  let dir = "";
  const previous = process.env.UPLOADS_DIR;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "poster-"));
    process.env.UPLOADS_DIR = dir;
    mkdirSync(join(dir, POSTER_DIR), { recursive: true });
    writeFileSync(join(dir, POSTER_DIR, BG), await fakeBackground());
  });
  after(() => {
    if (previous === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("рисует JPEG 1080×1350 поверх фона любого размера", async () => {
    const out = await renderPosterImage(await fakeBackground(), { ...defaultPosterTexts(), screen: "grid" });
    assert.equal(out[0], 0xff);
    assert.equal(out[1], 0xd8);
    const image = await loadImage(out);
    assert.equal(image.width, 1080);
    assert.equal(image.height, 1350);
  });

  it("длинное слово, пустая карточка и другой экран не ломают сборку", async () => {
    const out = await renderPosterImage(await fakeBackground(), {
      ...defaultPosterTexts(),
      word: "САНПИНХАССП",
      cardTitle: "",
      cardValue: "",
      kicker: "",
      screen: "qr",
    });
    assert.ok(out.length > 50_000);
  });

  it("«Обновить надписи»: тот же фон, одинаковые надписи — тот же файл, другие — новый", async () => {
    const texts = defaultPosterTexts();
    const first = await composePoster({ background: BG, screen: "grid", ...texts });
    assert.match(first.image, /^poster-[0-9a-f]{24}\.jpg$/);
    assert.ok(existsSync(join(dir, POSTER_DIR, first.image)));
    assert.equal(first.imageKey, posterTextsKey({ ...texts, screen: "grid", background: BG }));
    const again = await composePoster({ background: BG, screen: "grid", ...texts });
    assert.equal(again.image, first.image);
    const other = await composePoster({ background: BG, screen: "grid", ...texts, word: "ЖУРНАЛЫ" });
    assert.notEqual(other.image, first.image);
    assert.ok(existsSync(join(dir, POSTER_DIR, BG)), "фон остаётся — новая генерация не нужна");
  });

  it("чужой файл, неизвестный фон и плохие надписи — понятная ошибка", async () => {
    await assert.rejects(composePoster({ background: "../../.env", word: "ХАССП" }), PosterError);
    await assert.rejects(composePoster({ background: "bg-00000000-0000-0000-0000-000000000000.jpg", word: "ХАССП" }), /не найден/);
    await assert.rejects(composePoster({ background: BG, word: "ДВА СЛОВА" }), /одно слово/);
  });

  it("статус фона: готовый файл отдаётся без шлюза, мусор вместо id — ошибка", async () => {
    assert.deepEqual(await posterBackgroundStatus(JOB), { status: "ready", background: BG });
    await assert.rejects(posterBackgroundStatus("../etc/passwd"), PosterError);
  });
});

describe("постер письма: промпт и вёрстка", () => {
  it("фон — без текста и без телефона, в палитре бренда, сцена по выбору", () => {
    const prompt = posterBackgroundPrompt("canteen");
    assert.match(prompt, /no text, letters, numbers/);
    assert.match(prompt, /do NOT draw any phone/);
    assert.match(prompt, /#0B1024/);
    assert.match(prompt, /canteen/);
    assert.doesNotMatch(posterBackgroundPrompt("restaurant"), /canteen/);
  });

  it("подпись карточки — в две строки поровну, предлог не висит", () => {
    assert.deepEqual(twoLines("ТАРИФ СТАНДАРТ В МЕСЯЦ"), ["ТАРИФ СТАНДАРТ", "В МЕСЯЦ"]);
    assert.deepEqual(twoLines("БЕСПЛАТНО"), ["БЕСПЛАТНО", ""]);
  });
});
