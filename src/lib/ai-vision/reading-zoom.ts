/**
 * Увеличенный фрагмент у верха столбика (или конца стрелки) для чтения
 * аналогового термометра по фото (2026-09-27).
 *
 * Зачем: исполнитель видит фото уменьшенным, и у стеклянного термометра
 * тонкий бледный столбик и мелкие черты шкалы сливаются — на фото
 * владельца (32 °C) модель читала 27–28, у трёх термометров — «−20» или
 * «не разобрали». С увеличенным фрагментом у верха столбика — 30–32 и 21–22
 * (проверка на живом исполнителе, `.agent/tasks/liquid-thermometer-2026-09`).
 *
 * Как: окрашенная жидкость (красная, розовая, синяя) или стрелка — длинная
 * тонкая цветная линия. Ищем такие связные области на уменьшенной копии,
 * берём самую длинную ближе к центру кадра, а у неё — узкий конец: у
 * столбика широкий конец — колба, у стрелки — ось. Вокруг конца вырезаем
 * квадрат (18 % кадра — две-три подписанные черты шкалы) и увеличиваем. Не нашли — фрагмента нет, модель
 * читает по одному фото, как раньше (цифровой дисплей, серебристая ртуть).
 *
 * Поиск — чистая функция над RGBA (`findReadingZoom`, тест на синтетике);
 * JPEG — `makeReadingZoomJpeg` (server-only, `@napi-rs/canvas`).
 */

export type RgbaImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
export type ReadingZoomBox = { x: number; y: number; size: number; tip: { x: number; y: number } };

/** Сторона уменьшенной копии для поиска, px. */
const ANALYSIS_PX = 600;
/** Сторона вырезаемого квадрата — доля длинной стороны фото. */
export const READING_ZOOM_SHARE = 0.18;
/** Сторона фрагмента на выходе, px, и предел увеличения. */
const OUTPUT_PX = 1000;
const MAX_UPSCALE = 4;
/** Линия: не короче этой доли длинной стороны и во столько раз длиннее ширины. */
const MIN_LENGTH_SHARE = 0.15;
const MIN_ELONGATION = 20;
/**
 * Столбик тонкий: не толще этой доли длинной стороны (на копии 600 px — ~5 px).
 * Толще — кожа пальцев, красные засечки и цифры шкалы, детали экрана.
 */
const MAX_WIDTH_SHARE = 0.008;

type Channel = "red" | "blue";

/**
 * Красная или розовая жидкость. Бледный столбик на фото — около (250, 215, 200):
 * порог «r − g ≥ 35» рвал его на куски; мерило — насколько красный выше
 * среднего зелёного и синего (у столбика 40–46, у белой шкалы — около 8).
 */
function isRed(r: number, g: number, b: number): boolean {
  return r >= 120 && r - (g + b) / 2 >= 25 && r - g >= 20;
}

/** Синяя жидкость. */
function isBlue(r: number, g: number, b: number): boolean {
  return b >= 100 && b - r >= 35 && b - g >= 10;
}

type Candidate = { length: number; score: number; tip: { x: number; y: number } };

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

/** Уменьшенная копия (ближайший сосед) — только для поиска. */
function shrink(image: RgbaImage): { rgb: (x: number, y: number) => [number, number, number]; width: number; height: number; scale: number } {
  const scale = Math.min(1, ANALYSIS_PX / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const rgb = (x: number, y: number): [number, number, number] => {
    const sx = Math.min(image.width - 1, Math.floor(x / scale));
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    const i = (sy * image.width + sx) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  };
  return { rgb, width, height, scale };
}

function candidatesFor(
  small: ReturnType<typeof shrink>,
  channel: Channel,
): Candidate[] {
  const { width, height } = small;
  const mask = new Uint8Array(width * height);
  const test = channel === "red" ? isRed : isBlue;
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = small.rgb(x, y);
      if (test(r, g, b)) raw[y * width + x] = 1;
    }
  }
  // Тонкое по горизонтали: цветные отрезки шире MAX_RUN — засечки и цифры
  // шкалы, кожа, детали экрана — выкидываем; столбик (даже наклонный) узкий.
  const maxRun = Math.max(4, Math.round(0.01 * Math.max(width, height)));
  const thin = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (!raw[y * width + x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < width && raw[y * width + end]) end += 1;
      if (end - x <= maxRun) for (let k = x; k < end; k += 1) thin[y * width + k] = 1;
      x = end;
    }
  }
  // Засечка поперёк столбика выбивает из него строку — сшиваем разрывы до 3 строк.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (thin[index]) {
        mask[index] = 1;
        continue;
      }
      let above = false;
      let below = false;
      for (let d = 1; d <= 3 && !(above && below); d += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (y - d >= 0 && thin[(y - d) * width + nx]) above = true;
          if (y + d < height && thin[(y + d) * width + nx]) below = true;
        }
      }
      if (above && below) mask[index] = 1;
    }
  }

  const seen = new Uint8Array(width * height);
  const out: Candidate[] = [];
  const longSide = Math.max(width, height);
  const diagonal = Math.hypot(width, height);
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      xs.push(x);
      ys.push(y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (xs.length < 12) continue;

    // Главная ось области.
    const n = xs.length;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i += 1) {
      cx += xs[i];
      cy += ys[i];
    }
    cx /= n;
    cy /= n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = xs[i] - cx;
      const dy = ys[i] - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    const along: number[] = new Array(n);
    const across: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const dx = xs[i] - cx;
      const dy = ys[i] - cy;
      along[i] = dx * ux + dy * uy;
      across[i] = -dx * uy + dy * ux;
    }
    const sortedAlong = [...along].sort((a, b) => a - b);
    const low = percentile(sortedAlong, 0.01);
    const high = percentile(sortedAlong, 0.99);
    const length = high - low;
    let spread = 0;
    for (let i = 0; i < n; i += 1) spread += Math.abs(across[i]);
    const widthEstimate = Math.max(1, (2 * spread) / n);
    if (length < MIN_LENGTH_SHARE * longSide || length / widthEstimate < MIN_ELONGATION) continue;
    if (widthEstimate > Math.max(3, MAX_WIDTH_SHARE * longSide)) continue;
    // Столбик термометра — почти вертикальный (наклон кадра до 40°); стрелки
    // круглых приборов смотрят куда угодно — их конец так не найти.
    if (Math.abs(uy) < Math.cos((40 * Math.PI) / 180)) continue;

    // Концы: 15 % длины с каждой стороны; узкий — показание (широкий — колба или ось стрелки).
    const band = 0.15 * length;
    let lowWidth = 0;
    let lowCount = 0;
    let highWidth = 0;
    let highCount = 0;
    for (let i = 0; i < n; i += 1) {
      if (along[i] <= low + band) {
        lowWidth += Math.abs(across[i]);
        lowCount += 1;
      } else if (along[i] >= high - band) {
        highWidth += Math.abs(across[i]);
        highCount += 1;
      }
    }
    const lowMean = lowCount ? lowWidth / lowCount : 0;
    const highMean = highCount ? highWidth / highCount : 0;
    const lowPoint = { x: cx + ux * low, y: cy + uy * low };
    const highPoint = { x: cx + ux * high, y: cy + uy * high };
    let tip: { x: number; y: number };
    const ratio = Math.max(lowMean, highMean) / Math.max(0.5, Math.min(lowMean, highMean));
    if (ratio >= 1.3) {
      tip = lowMean < highMean ? lowPoint : highPoint;
    } else {
      // Одинаковые концы (колба не попала в кадр) — верхний: термометры висят колбой вниз.
      tip = lowPoint.y <= highPoint.y ? lowPoint : highPoint;
    }

    const centerDistance = Math.hypot(cx - width / 2, cy - height / 2) / diagonal;
    out.push({ length, score: length * (1 - 0.8 * centerDistance), tip });
  }
  return out;
}

/**
 * Где на фото конец столбика или стрелки и какой квадрат вокруг него
 * вырезать (координаты исходного фото). `null` — длинной цветной линии нет.
 */
export function findReadingZoom(image: RgbaImage): ReadingZoomBox | null {
  if (image.width < 32 || image.height < 32) return null;
  const small = shrink(image);
  const candidates = [...candidatesFor(small, "red"), ...candidatesFor(small, "blue")];
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  const tip = { x: best.tip.x / small.scale, y: best.tip.y / small.scale };
  const size = Math.round(Math.min(image.width, image.height, READING_ZOOM_SHARE * Math.max(image.width, image.height)));
  const x = Math.round(Math.min(Math.max(tip.x - size / 2, 0), image.width - size));
  const y = Math.round(Math.min(Math.max(tip.y - size / 2, 0), image.height - size));
  return { x, y, size, tip: { x: Math.round(tip.x), y: Math.round(tip.y) } };
}

/** Во сколько раз увеличить вырезанный квадрат. */
export function readingZoomScale(size: number): number {
  return Math.min(MAX_UPSCALE, Math.max(1, OUTPUT_PX / Math.max(1, size)));
}

/**
 * JPEG увеличенного фрагмента или `null` (нет цветной линии, фото не
 * открылось). Server-only: `@napi-rs/canvas`.
 */
export async function makeReadingZoomJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(Buffer.from(bytes));
    const source = createCanvas(image.width, image.height);
    const sourceContext = source.getContext("2d");
    sourceContext.drawImage(image, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, image.width, image.height);
    const box = findReadingZoom({ data: pixels.data, width: image.width, height: image.height });
    if (!box) return null;
    const side = Math.round(box.size * readingZoomScale(box.size));
    const canvas = createCanvas(side, side);
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(source, box.x, box.y, box.size, box.size, 0, 0, side, side);
    // Синий треугольник остриём к верху столбика — справа от него. Где верх,
    // сайт знает точнее модели (±0,3 °C на фото владельца); модель ошибалась
    // именно тут: «чуть ниже черты 30» при столбике на 2 деления выше.
    const scale = side / box.size;
    const tipX = (box.tip.x - box.x) * scale;
    const tipY = (box.tip.y - box.y) * scale;
    const unit = Math.max(8, Math.round(side / 55));
    context.fillStyle = "rgb(0,90,255)";
    context.beginPath();
    context.moveTo(tipX + unit * 0.6, tipY);
    context.lineTo(tipX + unit * 2.4, tipY - unit * 0.8);
    context.lineTo(tipX + unit * 2.4, tipY + unit * 0.8);
    context.closePath();
    context.fill();
    return new Uint8Array(canvas.toBuffer("image/jpeg", 88));
  } catch (error) {
    console.warn(`[ai-vision] reading zoom failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
