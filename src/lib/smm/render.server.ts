import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BrandProfile } from "./quality";
import { findTemplate, fitFont, wrapText, type TemplateData, type TemplateKey } from "./templates";

/**
 * Рисует картинку поста по шаблону бренда (A23, B29) на @napi-rs/canvas.
 * Шрифт — Manrope из src/lib/pdf-fonts (кириллица), логотип — знак бренда
 * из public/brand, перекрашенный в нужный цвет. Возвращает PNG.
 */

const FONT_DIR = join(process.cwd(), "src", "lib", "pdf-fonts");
const LOGO_PATH = join(process.cwd(), "public", "brand", "wordmark-dark.png");
let fontsReady = false;

type Canvas = import("@napi-rs/canvas").Canvas;
type Ctx = import("@napi-rs/canvas").SKRSContext2D;
type Img = import("@napi-rs/canvas").Image;

async function canvasLib() {
  const lib = await import("@napi-rs/canvas");
  if (!fontsReady) {
    lib.GlobalFonts.registerFromPath(join(FONT_DIR, "Manrope-ExtraBold.ttf"), "BrandHeavy");
    lib.GlobalFonts.registerFromPath(join(FONT_DIR, "Manrope-SemiBold.ttf"), "BrandSemi");
    lib.GlobalFonts.registerFromPath(join(FONT_DIR, "Manrope-Regular.ttf"), "BrandRegular");
    fontsReady = true;
  }
  return lib;
}

/** Логотип в нужном цвете: рисуем знак и заливаем по его альфе. */
async function tintedLogo(color: string): Promise<Canvas | null> {
  const lib = await canvasLib();
  try {
    const image = await lib.loadImage(await readFile(LOGO_PATH));
    const canvas = lib.createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, image.width, image.height);
    return canvas;
  } catch {
    return null;
  }
}

function cover(ctx: Ctx, image: Img, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function chip(ctx: Ctx, text: string, x: number, y: number, bg: string, fg: string, size = 30) {
  ctx.font = `${size}px BrandSemi`;
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.75;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + size * 0.6, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  return w;
}

function drawLines(ctx: Ctx, lines: string[], x: number, y: number, size: number, lineHeight: number) {
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * size * lineHeight));
}

export interface RenderInput {
  template: TemplateKey;
  data: TemplateData;
  /** Фото (байты jpg/png/webp) — для шаблонов с фото. */
  photo?: Uint8Array | null;
  profile: BrandProfile;
}

export async function renderTemplate(input: RenderInput): Promise<Buffer> {
  const def = findTemplate(input.template);
  if (!def) throw new Error(`Нет шаблона ${input.template}`);
  const lib = await canvasLib();
  const { width: W, height: H } = def;
  const canvas = lib.createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const { colors } = input.profile;
  const photo = input.photo?.length ? await lib.loadImage(Buffer.from(input.photo)) : null;
  const measureAt = (font: string) => (s: string, size: number) => {
    ctx.font = `${size}px ${font}`;
    return ctx.measureText(s).width;
  };
  const title = input.data.title.trim() || input.profile.name;
  const pad = Math.round(W * 0.06);

  if (def.key === "photo-band") {
    if (photo) cover(ctx, photo, 0, 0, W, H);
    else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, colors.primary);
      g.addColorStop(1, colors.dark);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const shade = ctx.createLinearGradient(0, H * 0.35, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, `${colors.dark}f0`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.22);
    top.addColorStop(0, "rgba(0,0,0,0.45)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.22);
    const logo = await tintedLogo("#ffffff");
    if (logo) ctx.drawImage(logo, pad, pad * 0.8, 230, (230 * logo.height) / logo.width);
    const fit = fitFont(title, W - pad * 2, measureAt("BrandHeavy"), [76, 68, 60, 54, 48], 3);
    const lineH = 1.16;
    const blockH = fit.lines.length * fit.size * lineH;
    const baseY = H - pad - blockH + fit.size;
    if (input.data.rubric) chip(ctx, input.data.rubric, pad, baseY - fit.size - 78, colors.primary, "#ffffff");
    ctx.fillStyle = "#ffffff";
    ctx.font = `${fit.size}px BrandHeavy`;
    drawLines(ctx, fit.lines, pad, baseY, fit.size, lineH);
    ctx.fillStyle = colors.primary;
    ctx.fillRect(0, H - 14, W, 14);
  } else if (def.key === "photo-frame") {
    ctx.fillStyle = colors.light;
    ctx.fillRect(0, 0, W, H);
    const photoH = Math.round(H * 0.58);
    ctx.save();
    roundRect(ctx, pad, pad, W - pad * 2, photoH, 36);
    ctx.clip();
    if (photo) cover(ctx, photo, pad, pad, W - pad * 2, photoH);
    else {
      ctx.fillStyle = colors.primary;
      ctx.fillRect(pad, pad, W - pad * 2, photoH);
    }
    ctx.restore();
    ctx.lineWidth = 10;
    ctx.strokeStyle = colors.primary;
    roundRect(ctx, pad, pad, W - pad * 2, photoH, 36);
    ctx.stroke();
    let y = pad + photoH + 60;
    if (input.data.rubric) {
      chip(ctx, input.data.rubric, pad, y, colors.primary, "#ffffff", 28);
      y += 80;
    }
    const fit = fitFont(title, W - pad * 2, measureAt("BrandHeavy"), [64, 58, 52, 46], 3);
    ctx.fillStyle = colors.dark;
    ctx.font = `${fit.size}px BrandHeavy`;
    drawLines(ctx, fit.lines, pad, y + fit.size, fit.size, 1.14);
    y += fit.lines.length * fit.size * 1.14 + 20;
    if (input.data.subtitle) {
      ctx.font = "36px BrandRegular";
      ctx.fillStyle = `${colors.dark}cc`;
      const lines = wrapText(input.data.subtitle, W - pad * 2 - 230, (s) => ctx.measureText(s).width, 3);
      drawLines(ctx, lines, pad, y + 36, 36, 1.3);
    }
    const logo = await tintedLogo(colors.primary);
    if (logo) ctx.drawImage(logo, W - pad - 190, H - pad - 50, 190, (190 * logo.height) / logo.width);
  } else if (def.key === "card") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, colors.primary);
    g.addColorStop(1, colors.dark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `${colors.accent}33`;
    ctx.beginPath();
    ctx.arc(W * 0.92, H * 0.1, W * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W * 0.05, H * 0.98, W * 0.22, 0, Math.PI * 2);
    ctx.fill();
    const logo = await tintedLogo("#ffffff");
    if (logo) ctx.drawImage(logo, pad, pad, 220, (220 * logo.height) / logo.width);
    let y = H * 0.32;
    if (input.data.rubric) {
      chip(ctx, input.data.rubric, pad, y - 90, "#ffffff", colors.primary, 30);
    }
    const fit = fitFont(title, W - pad * 2, measureAt("BrandHeavy"), [84, 74, 66, 58, 50], 4);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${fit.size}px BrandHeavy`;
    drawLines(ctx, fit.lines, pad, y + fit.size, fit.size, 1.12);
    y += fit.lines.length * fit.size * 1.12 + 40;
    if (input.data.subtitle) {
      ctx.font = "40px BrandRegular";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const lines = wrapText(input.data.subtitle, W - pad * 2, (s) => ctx.measureText(s).width, 4);
      drawLines(ctx, lines, pad, y + 40, 40, 1.32);
    }
  } else if (def.key === "promo") {
    ctx.fillStyle = colors.dark;
    ctx.fillRect(0, 0, W, H);
    const half = Math.round(W * 0.46);
    if (photo) {
      cover(ctx, photo, W - half, 0, half, H);
      const fade = ctx.createLinearGradient(W - half, 0, W - half + 160, 0);
      fade.addColorStop(0, colors.dark);
      fade.addColorStop(1, `${colors.dark}00`);
      ctx.fillStyle = fade;
      ctx.fillRect(W - half, 0, 160, H);
    } else {
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      ctx.arc(W * 0.86, H * 0.5, H * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    const textW = (photo ? W - half : W * 0.62) - pad;
    const logo = await tintedLogo("#ffffff");
    if (logo) ctx.drawImage(logo, pad, pad, 200, (200 * logo.height) / logo.width);
    let y = H * 0.24;
    if (input.data.offer) {
      const offerFit = fitFont(input.data.offer, textW - pad, measureAt("BrandHeavy"), [190, 160, 130, 110, 90], 1);
      ctx.fillStyle = colors.accent;
      ctx.font = `${offerFit.size}px BrandHeavy`;
      ctx.fillText(offerFit.lines[0], pad, y + offerFit.size * 0.85);
      y += offerFit.size * 1.05;
    }
    const fit = fitFont(title, textW - pad, measureAt("BrandHeavy"), [60, 54, 48, 42, 38], 5);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${fit.size}px BrandHeavy`;
    drawLines(ctx, fit.lines, pad, y + fit.size, fit.size, 1.14);
    y += fit.lines.length * fit.size * 1.14 + 40;
    if (input.data.deadline) chip(ctx, input.data.deadline, pad, Math.min(y, H - pad - 70), colors.primary, "#ffffff", 32);
  }

  return canvas.toBuffer("image/png");
}
