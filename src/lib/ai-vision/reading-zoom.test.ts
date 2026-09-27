import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCanvas } from "@napi-rs/canvas";

import { findReadingZoom, makeReadingZoomJpeg, readingZoomScale } from "@/lib/ai-vision/reading-zoom";
import { buildVisionInstruction, READING_ZOOM_NOTE } from "@/lib/ai-vision/instructions";

type Draw = (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void;

/** Белая шкала с чёрными засечками (как у настенного термометра) + что нарисует тест. */
function picture(draw: Draw, width = 600, height = 1000) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(240,238,230)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgb(30,30,30)";
  for (let y = 120; y < 900; y += 10) {
    const long = (y - 120) % 100 === 0;
    ctx.fillRect(long ? 230 : 255, y, long ? 55 : 30, 2);
    ctx.fillRect(315, y, long ? 55 : 30, 2);
  }
  draw(ctx);
  return { canvas, image: { data: ctx.getImageData(0, 0, width, height).data, width, height } };
}

/** Столбик: тонкая линия от колбы вверх до `top`, колба — широкий прямоугольник внизу. */
function column(color: string, top: number): Draw {
  return (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(298, top, 4, 880 - top);
    ctx.fillRect(288, 880, 24, 40);
  };
}

describe("findReadingZoom — где верх столбика", () => {
  it("красный столбик: верх найден, квадрат вокруг него", () => {
    const { image } = picture(column("rgb(215,55,55)", 330));
    const box = findReadingZoom(image);
    assert.ok(box, "столбик не найден");
    assert.ok(Math.abs(box.tip.y - 330) <= 15, `верх ${box.tip.y}, ожидали ~330`);
    assert.ok(Math.abs(box.tip.x - 300) <= 6, `x ${box.tip.x}`);
    assert.ok(box.x <= box.tip.x && box.tip.x <= box.x + box.size);
    assert.ok(box.y <= box.tip.y && box.tip.y <= box.y + box.size);
  });

  it("бледный розовый столбик (как на фото владельца) тоже находится", () => {
    const box = findReadingZoom(picture(column("rgb(250,212,202)", 520)).image);
    assert.ok(box, "бледный столбик не найден");
    assert.ok(Math.abs(box.tip.y - 520) <= 15, `верх ${box.tip.y}`);
  });

  it("синий столбик", () => {
    const box = findReadingZoom(picture(column("rgb(50,80,215)", 700)).image);
    assert.ok(box, "синий столбик не найден");
    assert.ok(Math.abs(box.tip.y - 700) <= 15, `верх ${box.tip.y}`);
  });

  it("широкое красное пятно (пальцы, кожа) — не столбик", () => {
    const box = findReadingZoom(picture((ctx) => {
      ctx.fillStyle = "rgb(210,150,140)";
      ctx.fillRect(60, 500, 180, 400);
    }).image);
    assert.equal(box, null);
  });

  it("цифры красного табло — не столбик", () => {
    const box = findReadingZoom(picture((ctx) => {
      ctx.fillStyle = "rgb(250,40,40)";
      for (const x0 of [120, 260, 400]) {
        ctx.fillRect(x0, 300, 70, 12);
        ctx.fillRect(x0, 370, 70, 12);
        ctx.fillRect(x0, 440, 70, 12);
        ctx.fillRect(x0, 300, 12, 150);
        ctx.fillRect(x0 + 58, 300, 12, 150);
      }
    }).image);
    assert.equal(box, null);
  });

  it("горизонтальная красная стрелка — фрагмента нет (конец стрелки так не найти)", () => {
    const box = findReadingZoom(picture((ctx) => {
      ctx.fillStyle = "rgb(215,55,55)";
      ctx.fillRect(80, 500, 420, 4);
    }).image);
    assert.equal(box, null);
  });

  it("без цветного — null", () => {
    assert.equal(findReadingZoom(picture(() => {}).image), null);
  });
});

describe("makeReadingZoomJpeg", () => {
  it("JPEG увеличенного фрагмента у верха столбика", async () => {
    const { canvas } = picture(column("rgb(215,55,55)", 330));
    const zoom = await makeReadingZoomJpeg(new Uint8Array(canvas.toBuffer("image/png")));
    assert.ok(zoom, "фрагмента нет");
    assert.equal(zoom[0], 0xff);
    assert.equal(zoom[1], 0xd8);
  });

  it("не картинка — null, без исключения", async () => {
    assert.equal(await makeReadingZoomJpeg(new Uint8Array([1, 2, 3, 4])), null);
  });

  it("увеличение — до ~1000 px, не больше чем в 4 раза", () => {
    assert.equal(readingZoomScale(250), 4);
    assert.ok(Math.abs(readingZoomScale(288) * 288 - 1000) < 1);
    assert.equal(readingZoomScale(2000), 1);
  });
});

describe("инструкция со вторым фото", () => {
  it("строка про увеличенный фрагмент — только при zoom", () => {
    assert.ok(buildVisionInstruction("reading", { metric: "temperature", zoom: true }).includes(READING_ZOOM_NOTE));
    assert.ok(!buildVisionInstruction("reading", { metric: "temperature" }).includes(READING_ZOOM_NOTE));
    assert.ok(!buildVisionInstruction("menu", { zoom: true }).includes(READING_ZOOM_NOTE));
  });
});
