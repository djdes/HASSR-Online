import path from "node:path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { encodeGif, type GifFrame } from "@/lib/gif/encoder";
import { countdownParts, type CountdownTheme } from "@/lib/mailing/countdown";

const WIDTH = 600;
const HEIGHT = 150;
const FRAMES = 60;
const SHADES = 12;

type Colors = { bg: string; tile: string; digits: string; label: string; accent: string };

const THEMES: Record<CountdownTheme, Colors> = {
  dark: { bg: "#0b1024", tile: "#161c3a", digits: "#ffffff", label: "#9b9fb3", accent: "#7cf5c0" },
  light: { bg: "#ffffff", tile: "#eef1ff", digits: "#0b1024", label: "#6f7282", accent: "#5566f6" },
};

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "src", "lib", "pdf-fonts");
  GlobalFonts.registerFromPath(path.join(dir, "Manrope-ExtraBold.ttf"), "Manrope ExtraBold");
  GlobalFonts.registerFromPath(path.join(dir, "Manrope-SemiBold.ttf"), "Manrope SemiBold");
  fontsReady = true;
}

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];
}

/** Палитра темы: ступени «фон → цифры», «плашка → цифры», «плашка → подпись» (всего 32 цвета), акцент. */
function buildPalette(c: Colors): [number, number, number][] {
  const bg = hex(c.bg);
  const tile = hex(c.tile);
  const digits = hex(c.digits);
  const label = hex(c.label);
  const pal: [number, number, number][] = [bg, tile, digits, label, hex(c.accent)];
  for (let i = 1; i < SHADES; i++) {
    const t = i / SHADES;
    pal.push(mix(bg, digits, t), mix(tile, digits, t));
  }
  for (let i = 1; i <= 5; i++) pal.push(mix(tile, label, i / 6));
  return pal;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function drawFrame(ctx: SKRSContext2D, c: Colors, until: Date, at: Date) {
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const parts = countdownParts(until, at);
  if (parts.ended) {
    ctx.fillStyle = c.digits;
    ctx.font = "34px 'Manrope ExtraBold'";
    ctx.fillText("Акция завершилась", WIDTH / 2, HEIGHT / 2 - 4);
  } else {
    const items: [string, string][] = [
      [pad2(parts.days), "ДНЕЙ"],
      [pad2(parts.hours), "ЧАСОВ"],
      [pad2(parts.minutes), "МИНУТ"],
      [pad2(parts.seconds), "СЕКУНД"],
    ];
    const tileW = 118;
    const gap = 32;
    const total = tileW * 4 + gap * 3;
    const x0 = (WIDTH - total) / 2;
    const y0 = 16;
    const tileH = 108;
    items.forEach(([value, label], i) => {
      const x = x0 + i * (tileW + gap);
      ctx.fillStyle = c.tile;
      roundRect(ctx, x, y0, tileW, tileH, 16);
      ctx.fill();
      ctx.fillStyle = c.digits;
      ctx.font = "54px 'Manrope ExtraBold'";
      ctx.fillText(value, x + tileW / 2, y0 + 46);
      ctx.fillStyle = c.label;
      ctx.font = "13px 'Manrope SemiBold'";
      ctx.fillText(label, x + tileW / 2, y0 + 88);
      if (i < 3) {
        ctx.fillStyle = c.label;
        ctx.font = "40px 'Manrope ExtraBold'";
        ctx.fillText(":", x + tileW + gap / 2, y0 + 44);
      }
    });
  }
  // Тонкая полоса-акцент снизу.
  ctx.fillStyle = c.accent;
  ctx.fillRect(WIDTH / 2 - 40, HEIGHT - 8, 80, 3);
}

/** Анимированный GIF-таймер до `until`: 60 кадров по секунде, играет один раз. */
export function renderCountdownGif(until: Date, theme: CountdownTheme, now: Date): Buffer {
  ensureFonts();
  const colors = THEMES[theme];
  const palette = buildPalette(colors);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };

  const frames: GifFrame[] = [];
  let prev: Uint8Array | null = null;
  const base = now.getTime();
  const total = countdownParts(until, now).ended ? 1 : FRAMES;
  for (let i = 0; i < total; i++) {
    const at = new Date(base + i * 1000);
    drawFrame(ctx, colors, until, at);
    const rgba = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
    const pixels = new Uint8Array(WIDTH * HEIGHT);
    for (let p = 0; p < pixels.length; p++) {
      pixels[p] = nearest(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
    }
    if (!prev) {
      frames.push({ pixels, delayCs: 100 });
    } else {
      // Разностный кадр: рамка изменившихся пикселей относительно прошлого.
      let x0 = WIDTH, y0 = HEIGHT, x1 = -1, y1 = -1;
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          if (pixels[y * WIDTH + x] !== prev[y * WIDTH + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
      }
      if (x1 < 0) {
        // Ничего не изменилось — крошечный кадр из одного пикселя.
        x0 = x1 = y0 = y1 = 0;
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const part = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        part.set(pixels.subarray((y0 + y) * WIDTH + x0, (y0 + y) * WIDTH + x0 + w), y * w);
      }
      frames.push({ pixels: part, delayCs: 100, rect: { left: x0, top: y0, width: w, height: h } });
    }
    prev = pixels;
  }
  return encodeGif({ width: WIDTH, height: HEIGHT, palette, frames, loop: null });
}
