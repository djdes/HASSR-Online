import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CodexGatewayError, downloadImage, readImageJob, startImageJob } from "@/lib/codex-gateway";
import {
  POSTER_DIR,
  POSTER_PHONE,
  POSTER_SIZE,
  checkPosterTexts,
  isPosterBackgroundFile,
  posterTextsKey,
  posterWord,
  type PosterScene,
  type PosterScreen,
  type PosterTexts,
} from "@/lib/mailing/kinds/poster-shared";
import { uploadsDir } from "@/lib/uploads-path";

/**
 * Постер письма «Постер» (референс владельца 26.11.2026 — флаер суши-бара:
 * тёмный фон, плашка, гигантское узкое слово, герой поверх низа букв,
 * карточка сбоку, внизу «закажите» с крупным телефоном).
 *
 *   • фон без текста — шлюз картинок ProjectsFlow (`codex-gateway.ts`),
 *     1–3 минуты, поэтому «поставить» и «проверить» — отдельные шаги;
 *   • надписи, карточку и телефон с настоящим экраном кабинета рисует
 *     сервер (@napi-rs/canvas, Oswald + Manrope из `src/lib/pdf-fonts`) —
 *     текст ровный и не выдуман генератором;
 *   • файлы — в каталоге загрузок (`uploadsDir()/mailing-poster`): на проде
 *     это хранилище вне дерева, деплой его не стирает; отдаёт `/uploads/**`.
 */

export class PosterError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "PosterError";
  }
}

/** Меняется при правке вёрстки постера: новые сборки получают новое имя, старые письма не ломаются. */
const LAYOUT_VERSION = "v1";
const FONT_DIR = join(process.cwd(), "src", "lib", "pdf-fonts");
const SCREENS_DIR = join(process.cwd(), "public", "landing", "screens", "2026-11-21");
const WORDMARK = join(process.cwd(), "public", "brand", "wordmark.png");

export const posterDir = () => join(uploadsDir(), POSTER_DIR);

type Lib = typeof import("@napi-rs/canvas");
type Ctx = import("@napi-rs/canvas").SKRSContext2D;
type Img = import("@napi-rs/canvas").Image;

let fontsReady = false;
async function canvasLib(): Promise<Lib> {
  const lib = await import("@napi-rs/canvas");
  if (!fontsReady) {
    const fonts: [string, string][] = [
      ["Oswald-Bold.ttf", "Poster Display"],
      ["Oswald-SemiBold.ttf", "Poster Display Semi"],
      ["Manrope-ExtraBold.ttf", "Poster Body"],
    ];
    for (const [file, family] of fonts) {
      if (!lib.GlobalFonts.registerFromPath(join(FONT_DIR, file), family)) throw new Error(`Шрифт ${file} не загружен`);
    }
    fontsReady = true;
  }
  return lib;
}

async function save(name: string, data: Buffer): Promise<string> {
  const dir = posterDir();
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, target);
  return name;
}

// ---------------------------------------------------------------- фон

const SCENES: Record<PosterScene, string> = {
  restaurant:
    "a professional restaurant kitchen at night - stainless steel counters, a chef station with fresh herbs, a wooden cutting board, copper pans, soft rising steam",
  canteen:
    "a clean modern canteen kitchen at night - long stainless steel serving line, gastronorm trays, stacks of white plates, ladles, soft rising steam from the hot counter",
  production:
    "a clean modern food production workshop at night - stainless steel tables, industrial ovens and mixers, neatly stacked steel containers, soft rising steam",
};

/** Промпт фона: сцена в палитре бренда, пустой верх под слово и пустая середина под телефон, без текста. */
export function posterBackgroundPrompt(scene: PosterScene): string {
  return [
    "Vertical 4:5 commercial advertising poster background, photorealistic, premium tech-meets-restaurant flyer style.",
    `Scene: ${SCENES[scene]}, shot from a low three-quarter angle.`,
    "Colour grading: deep midnight navy (#0B1024) and indigo blue (#5566F6) ambient light, cool mint-cyan rim highlights (#7CF5C0) on steel edges, a small touch of warm light from the hood lamps. Dark, moody, high-contrast, cinematic.",
    "Composition: the upper 40% of the frame is a dark softly blurred backdrop with indigo bokeh lights, kept empty for a giant headline.",
    "The centre of the frame (from 35% to 90% of the height, horizontally centred, slightly right) is a clean darker area of the steel counter with a soft indigo glow on the surface, reserved for a smartphone that will be added later - do NOT draw any phone, tablet, screen, monitor or device.",
    "Keep the left-middle area and the bottom-right corner calm and dark.",
    "Add 3-4 out-of-focus flying fresh ingredients (basil leaves, a cherry tomato, a lemon slice, a rosemary sprig) near the frame edges (top-left, right edge, bottom-left) with strong depth-of-field blur and slight motion blur, like a dynamic food advertisement.",
    "Subtle dark vignette. Absolutely no text, letters, numbers, logos, watermarks, labels, signs, screens or devices anywhere in the image.",
  ].join(" ");
}

function gatewayError(error: unknown): never {
  if (error instanceof PosterError) throw error;
  if (error instanceof CodexGatewayError) throw new PosterError(`Генератор картинок: ${error.message}`, 502);
  throw error;
}

/** Ставит генерацию фона в очередь, возвращает id задания (1–3 минуты). */
export async function startPosterBackground(scene: PosterScene): Promise<string> {
  try {
    return await startImageJob(posterBackgroundPrompt(scene), POSTER_SIZE);
  } catch (error) {
    gatewayError(error);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Статус генерации; готовый фон приводится к 1080×1350 и сохраняется один раз. */
export async function posterBackgroundStatus(job: string): Promise<{ status: "pending" } | { status: "ready"; background: string }> {
  if (!UUID.test(job)) throw new PosterError("Некорректное задание генерации");
  const name = `bg-${job}.jpg`;
  if (existsSync(join(posterDir(), name))) return { status: "ready", background: name };
  try {
    const state = await readImageJob(job);
    if (state.status === "failed" || state.status === "cancelled") {
      throw new PosterError(`Фон не сгенерирован${state.error ? `: ${state.error.slice(0, 160)}` : ""}. Попробуйте ещё раз.`, 502);
    }
    if (state.status !== "succeeded") return { status: "pending" };
    const lib = await canvasLib();
    const source = await lib.loadImage(await downloadImage(job));
    const canvas = lib.createCanvas(POSTER_SIZE.width, POSTER_SIZE.height);
    cover(canvas.getContext("2d"), source, 0, 0, POSTER_SIZE.width, POSTER_SIZE.height);
    return { status: "ready", background: await save(name, await canvas.encode("jpeg", 92)) };
  } catch (error) {
    gatewayError(error);
  }
}

// ---------------------------------------------------------------- рисование

// Палитра бренда (брендбук «сетап» 1.0): полночь, индиго, лаванда, мята.
const MIDNIGHT = "#0b1024";
const INDIGO = "#5566f6";
const INDIGO_DEEP = "#3848c7";
const LAVENDER = "#a3aef8";
const MINT = "#7cf5c0";
const WHITE = "#ffffff";

/** Экран телефона: файл снимка и откуда его показывать (сверху срезаем шапку кабинета). */
const SCREEN_FILES: Record<PosterScreen, { file: string; top: number }> = {
  grid: { file: "grid-mobile.webp", top: 336 },
  dashboard: { file: "dashboard-mobile.webp", top: 0 },
  monitoring: { file: "monitoring-mobile.webp", top: 0 },
  inspection: { file: "inspection-mobile.webp", top: 0 },
  qr: { file: "qr-mobile.webp", top: 0 },
};

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

/** Наибольший размер шрифта (не больше max), при котором строка влезает в ширину. */
function fit(ctx: Ctx, text: string, family: string, max: number, width: number, min = 12): number {
  let size = max;
  for (; size > min; size -= 2) {
    ctx.font = `${size}px "${family}"`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

/** Делит подпись на две строки примерно поровну; короткий предлог не висит в конце строки. */
export function twoLines(text: string): [string, string] {
  const words = text.split(" ").filter(Boolean).reduce<string[]>((out, word) => {
    const last = out.at(-1);
    if (last && /^\p{L}{1,2}$/u.test(last)) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
    return out;
  }, []);
  if (words.length < 2) return [words.join(" "), ""];
  let best: [string, string] = [text, ""];
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const value = Math.max(a.length, b.length);
    if (value < score) {
      score = value;
      best = [a, b];
    }
  }
  return best;
}

/** Гигантское слово: объёмная тень, градиент лаванда → индиго, тонкий блик. Возвращает рамку. */
function drawWord(ctx: Ctx, word: string, centerX: number, top: number, maxWidth: number, maxCap: number) {
  ctx.font = '100px "Poster Display"';
  const cap = ctx.measureText(word).actualBoundingBoxAscent / 100;
  let size = maxCap / cap;
  ctx.font = `${size}px "Poster Display"`;
  let width = ctx.measureText(word).width;
  // Плакатный набор: длинное слово сначала сжимаем по горизонтали, потом уменьшаем.
  let scaleX = 1;
  if (width > maxWidth) {
    scaleX = Math.max(0.74, maxWidth / width);
    if (width * scaleX > maxWidth) {
      size *= maxWidth / (width * scaleX);
      ctx.font = `${size}px "Poster Display"`;
      width = ctx.measureText(word).width;
    }
  }
  const height = size * cap;
  const baseline = top + height;
  ctx.save();
  ctx.translate(centerX, baseline);
  ctx.scale(scaleX, 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const depth = Math.round(size / 28);
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#12184a";
  ctx.fillText(word, depth, depth);
  ctx.shadowColor = "transparent";
  for (let step = depth - 1; step > 0; step--) {
    ctx.fillStyle = step > depth / 2 ? "#161d58" : "#1f2878";
    ctx.fillText(word, step, step);
  }
  const gradient = ctx.createLinearGradient(0, -height, 0, 0);
  gradient.addColorStop(0, "#b9c2ff");
  gradient.addColorStop(0.45, "#7d8bff");
  gradient.addColorStop(1, INDIGO);
  ctx.fillStyle = gradient;
  ctx.fillText(word, 0, 0);
  ctx.lineWidth = Math.max(2, size / 170);
  ctx.strokeStyle = "rgba(231,236,255,.45)";
  ctx.strokeText(word, 0, 0);
  ctx.restore();
  const drawn = width * scaleX;
  return { top, bottom: baseline, left: centerX - drawn / 2, right: centerX + drawn / 2 };
}

/** Плашка над словом: мятная лента с тёмной обводкой, чуть наклонена. */
function drawKicker(ctx: Ctx, text: string, centerX: number, centerY: number) {
  const label = text.toLocaleUpperCase("ru-RU");
  const size = fit(ctx, label, "Poster Display Semi", 46, 640, 26);
  ctx.font = `${size}px "Poster Display Semi"`;
  const w = ctx.measureText(label).width + 60;
  const h = size + 30;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(-0.035);
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, -w / 2, -h / 2, w, h, 12);
  ctx.fillStyle = MINT;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 5;
  ctx.strokeStyle = MIDNIGHT;
  ctx.stroke();
  ctx.fillStyle = MIDNIGHT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 3);
  ctx.restore();
}

/** Телефон с настоящим экраном кабинета: корпус, стекло, вырез, блик, тень и индиго-свечение. */
async function drawPhone(lib: Lib, ctx: Ctx, screen: PosterScreen, cx: number, top: number, w: number, h: number, angle: number) {
  const spec = SCREEN_FILES[screen];
  const shot = await lib.loadImage(await readFile(join(SCREENS_DIR, spec.file)));
  const cy = top + h / 2;

  const glow = ctx.createRadialGradient(cx, cy, 40, cx, cy, w * 1.25);
  glow.addColorStop(0, "rgba(85,102,246,.55)");
  glow.addColorStop(0.55, "rgba(85,102,246,.18)");
  glow.addColorStop(1, "rgba(85,102,246,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - w * 1.4, cy - h * 0.8, w * 2.8, h * 1.6);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const x = -w / 2;
  const y = -h / 2;
  const r = w * 0.15;

  // Кнопки на рёбрах — под корпусом.
  ctx.fillStyle = "#2a2f45";
  roundRect(ctx, x - 6, y + h * 0.17, 10, h * 0.06, 4);
  ctx.fill();
  roundRect(ctx, x - 6, y + h * 0.25, 10, h * 0.1, 4);
  ctx.fill();
  roundRect(ctx, x + w - 4, y + h * 0.22, 10, h * 0.13, 4);
  ctx.fill();

  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetX = 18;
  ctx.shadowOffsetY = 34;
  roundRect(ctx, x, y, w, h, r);
  const body = ctx.createLinearGradient(x, y, x + w, y + h);
  body.addColorStop(0, "#3a4160");
  body.addColorStop(0.5, "#151a2c");
  body.addColorStop(1, "#2b3150");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(163,174,248,.55)";
  ctx.stroke();

  const bezel = w * 0.035;
  roundRect(ctx, x + bezel * 0.45, y + bezel * 0.45, w - bezel * 0.9, h - bezel * 0.9, r - bezel * 0.45);
  ctx.fillStyle = "#05070d";
  ctx.fill();

  const sx = x + bezel;
  const sy = y + bezel;
  const sw = w - bezel * 2;
  const sh = h - bezel * 2;
  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, r - bezel);
  ctx.clip();
  ctx.fillStyle = "#f5f6fb";
  ctx.fillRect(sx, sy, sw, sh);
  // Снимок — по ширине экрана, сверху отступ под строку состояния.
  const statusBar = sh * 0.055;
  const scale = sw / shot.width;
  const visible = Math.min(shot.height - spec.top, (sh - statusBar) / scale);
  ctx.drawImage(shot, 0, spec.top, shot.width, visible, sx, sy + statusBar, sw, visible * scale);
  // Строка состояния: время и значки — нарисованы, без выдуманного текста.
  ctx.fillStyle = MIDNIGHT;
  ctx.font = `${Math.round(sh * 0.02)}px "Poster Body"`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("9:41", sx + sw * 0.1, sy + statusBar * 0.55);
  // Связь — четыре столбика, батарея — контур с заливкой.
  const iconMid = sy + statusBar * 0.55;
  const unit = statusBar * 0.1;
  for (let i = 0; i < 4; i++) {
    const barH = unit * (1.4 + i * 0.75);
    roundRect(ctx, sx + sw * 0.7 + i * unit * 1.5, iconMid + unit * 1.6 - barH, unit, barH, unit * 0.3);
    ctx.fill();
  }
  const batX = sx + sw * 0.8;
  const batW = unit * 5.2;
  const batH = unit * 2.6;
  roundRect(ctx, batX, iconMid - batH / 2, batW, batH, unit * 0.7);
  ctx.lineWidth = Math.max(1.5, unit * 0.3);
  ctx.strokeStyle = MIDNIGHT;
  ctx.stroke();
  roundRect(ctx, batX + unit * 0.5, iconMid - batH / 2 + unit * 0.5, (batW - unit) * 0.8, batH - unit, unit * 0.4);
  ctx.fill();
  roundRect(ctx, batX + batW + unit * 0.3, iconMid - unit * 0.5, unit * 0.5, unit, unit * 0.2);
  ctx.fill();
  // Блик по стеклу.
  const shine = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh * 0.6);
  shine.addColorStop(0, "rgba(255,255,255,.16)");
  shine.addColorStop(0.42, "rgba(255,255,255,.05)");
  shine.addColorStop(0.43, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  // Вырез камеры.
  const pillW = sw * 0.3;
  const pillH = statusBar * 0.62;
  roundRect(ctx, -pillW / 2, sy + statusBar * 0.2, pillW, pillH, pillH / 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.restore();
}

/** Карточка-факт: подпись в одну-две строки и крупное значение. */
function drawCard(ctx: Ctx, title: string, value: string, x: number, y: number) {
  const w = 320;
  const inner = w - 70;
  const lines = title ? twoLines(title.toLocaleUpperCase("ru-RU")).filter(Boolean) : [];
  const titleSize = lines.length ? Math.min(...lines.map((line) => fit(ctx, line, "Poster Display Semi", 46, inner, 24))) : 0;
  const leading = Math.round(titleSize * 1.12);
  // «1 990 ₽»: число крупно, знак рубля — поменьше, как на ценнике.
  const match = /^(.*?)\s*(₽)$/.exec(value);
  const number = match ? match[1] : value;
  const unit = match ? "₽" : "";
  let size = 132;
  let numberWidth = 0;
  let unitWidth = 0;
  for (; size > 40; size -= 2) {
    ctx.font = `${size}px "Poster Display"`;
    numberWidth = ctx.measureText(number).width;
    ctx.font = `${Math.round(size * 0.46)}px "Poster Display"`;
    unitWidth = unit ? ctx.measureText(unit).width + 10 : 0;
    if (numberWidth + unitWidth <= inner) break;
  }
  ctx.font = `${size}px "Poster Display"`;
  const valueCap = value ? ctx.measureText(number).actualBoundingBoxAscent : 0;
  const pad = 40;
  const h = pad + lines.length * leading + (value ? (lines.length ? 22 : 0) + valueCap : 0) + pad - 4;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.03);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, 0, 0, w, h, 40);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.shadowColor = "transparent";
  roundRect(ctx, 12, 12, w - 24, h - 24, 30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INDIGO;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${titleSize}px "Poster Display Semi"`;
  let line = pad + titleSize * 0.86;
  lines.forEach((text, index) => {
    ctx.fillStyle = index === 0 && lines.length > 1 ? MIDNIGHT : INDIGO_DEEP;
    ctx.fillText(text, w / 2, line);
    line += leading;
  });
  if (value) {
    const left = (w - numberWidth - unitWidth) / 2;
    const base = h - pad + 4;
    ctx.textAlign = "left";
    ctx.fillStyle = MIDNIGHT;
    ctx.font = `${size}px "Poster Display"`;
    ctx.fillText(number, left, base);
    if (unit) {
      ctx.font = `${Math.round(size * 0.46)}px "Poster Display"`;
      ctx.fillText(unit, left + numberWidth + 10, base - valueCap + size * 0.36);
    }
  }
  ctx.restore();
  return { bottom: y + h };
}

/** Значок у призыва: мятный круг с галочкой. */
function drawCheckBadge(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.fillStyle = MINT;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = MIDNIGHT;
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.3);
  ctx.stroke();
  ctx.restore();
}

/** Белый знак «сетап» сверху по центру. */
async function drawWordmark(lib: Lib, ctx: Ctx, centerX: number, top: number, height: number) {
  try {
    const mark = await lib.loadImage(await readFile(WORDMARK));
    const width = (mark.width / mark.height) * height;
    ctx.drawImage(mark, centerX - width / 2, top, width, height);
  } catch {
    // Без знака постер всё равно собирается.
  }
}

export type PosterDrawInput = PosterTexts & { screen: PosterScreen };

/** Собирает постер поверх фона. Чистая функция от фона и надписей — удобно проверять. */
export async function renderPosterImage(background: Buffer, input: PosterDrawInput): Promise<Buffer> {
  const lib = await canvasLib();
  const { width: W, height: H } = POSTER_SIZE;
  const canvas = lib.createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  cover(ctx, await lib.loadImage(background), 0, 0, W, H);

  // Притемняем верх (слово) и весь кадр слегка — фон любой яркости не спорит с надписями.
  ctx.fillStyle = "rgba(11,16,36,.28)";
  ctx.fillRect(0, 0, W, H);
  const topShade = ctx.createLinearGradient(0, 0, 0, 640);
  topShade.addColorStop(0, "rgba(11,16,36,.85)");
  topShade.addColorStop(1, "rgba(11,16,36,0)");
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, W, 640);

  await drawWordmark(lib, ctx, W / 2, 46, 40);

  const word = posterWord(input.word) || "ХАССП";
  const wordTop = 214;
  const box = drawWord(ctx, word, W / 2, wordTop, 980, 300);

  // Телефон стоит перед словом: закрывает низ букв, как блюдо на флаере.
  const phoneW = 404;
  const phoneH = Math.round(phoneW * 2.06);
  await drawPhone(lib, ctx, input.screen, 648, box.bottom - 116, phoneW, phoneH, -0.1);

  // Низ уходит в темноту: телефон «вырастает» из неё, контакты читаются.
  const bottomShade = ctx.createLinearGradient(0, H - 560, 0, H);
  bottomShade.addColorStop(0, "rgba(11,16,36,0)");
  bottomShade.addColorStop(0.32, "rgba(11,16,36,.72)");
  bottomShade.addColorStop(0.55, "rgba(11,16,36,.93)");
  bottomShade.addColorStop(1, "rgba(11,16,36,.98)");
  ctx.fillStyle = bottomShade;
  ctx.fillRect(0, H - 560, W, 560);

  if (input.kicker) drawKicker(ctx, input.kicker, W / 2, wordTop - 26);
  if (input.cardTitle || input.cardValue) drawCard(ctx, input.cardTitle, input.cardValue.toLocaleUpperCase("ru-RU"), 76, Math.max(box.bottom + 80, 610));

  // Призыв, телефон и сайт — справа внизу, по правому краю.
  const right = W - 56;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 18;
  const cta = (input.cta || "Звоните").toLocaleUpperCase("ru-RU");
  ctx.font = `${fit(ctx, cta, "Poster Display Semi", 48, 780, 28)}px "Poster Display Semi"`;
  ctx.fillStyle = WHITE;
  const ctaWidth = ctx.measureText(cta).width;
  ctx.fillText(cta, right, H - 214);
  ctx.shadowColor = "transparent";
  drawCheckBadge(ctx, right - ctaWidth - 38, H - 230, 25);
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 18;
  const phone = POSTER_PHONE.display;
  ctx.font = `${fit(ctx, phone, "Poster Display", 104, 900, 48)}px "Poster Display"`;
  ctx.fillStyle = MINT;
  ctx.fillText(phone, right, H - 104);
  ctx.font = '34px "Poster Display Semi"';
  ctx.fillStyle = LAVENDER;
  ctx.fillText("WESETUP.RU · ЖУРНАЛЫ ХАССП И САНПИН", right, H - 50);
  ctx.shadowColor = "transparent";
  return canvas.encode("jpeg", 90);
}

/** Собирает постер с надписями поверх сохранённого фона; одинаковые надписи дают тот же файл. */
export async function composePoster(raw: unknown): Promise<{ image: string; imageKey: string }> {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const background = typeof input.background === "string" ? input.background : "";
  if (!isPosterBackgroundFile(background)) throw new PosterError("Сначала сгенерируйте фон постера");
  const file = join(posterDir(), background);
  if (!existsSync(file)) throw new PosterError("Фон постера не найден — сгенерируйте его заново", 404);
  const screen = (Object.keys(SCREEN_FILES) as PosterScreen[]).find((key) => key === input.screen) ?? "grid";
  const checked = checkPosterTexts(input);
  if (!checked.ok) throw new PosterError(checked.error);
  const art = { ...checked.texts, screen, background };
  const imageKey = posterTextsKey(art);
  const hash = createHash("sha256").update(JSON.stringify([LAYOUT_VERSION, imageKey])).digest("hex").slice(0, 24);
  const name = `poster-${hash}.jpg`;
  if (!existsSync(join(posterDir(), name))) {
    await save(name, await renderPosterImage(await readFile(file), { ...checked.texts, screen }));
  }
  return { image: name, imageKey };
}
