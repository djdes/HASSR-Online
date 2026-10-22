/**
 * Кодировщик анимированного GIF89a без зависимостей: глобальная палитра,
 * кадры с индексами палитры, LZW со сбросом таблицы на 4096 кодах.
 */
export type GifFrame = {
  /** Индексы палитры, длина width*height. */
  pixels: Uint8Array;
  /** Задержка кадра в сотых долях секунды. */
  delayCs: number;
  /** Необязательный прямоугольник кадра; `pixels` — только для него, остальное остаётся от прошлого кадра. */
  rect?: { left: number; top: number; width: number; height: number };
};

export function encodeGif(input: {
  width: number;
  height: number;
  palette: [number, number, number][];
  frames: GifFrame[];
  /** 0 — бесконечно, N — повторов, null — играть один раз. */
  loop?: number | null;
}): Buffer {
  const { width, height, palette, frames } = input;
  const loop = input.loop === undefined ? 0 : input.loop;
  if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
    throw new Error("некорректные размеры GIF");
  }
  if (palette.length < 1 || palette.length > 256) throw new Error("палитра: от 1 до 256 цветов");
  for (const f of frames) {
    const r = f.rect ?? { left: 0, top: 0, width, height };
    if (r.width < 1 || r.height < 1 || r.left < 0 || r.top < 0 || r.left + r.width > width || r.top + r.height > height) {
      throw new Error("прямоугольник кадра выходит за экран");
    }
    if (f.pixels.length !== r.width * r.height) throw new Error("длина кадра не равна размеру его прямоугольника");
  }

  // Размер палитры — степень двойки, минимум 2 цвета.
  let bits = 1;
  while (1 << bits < palette.length) bits++;
  const palSize = 1 << bits;
  const minCode = Math.max(2, bits);

  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  const ascii = (s: string) => {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  };

  ascii("GIF89a");
  u16(width);
  u16(height);
  out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < palSize; i++) out.push(...(palette[i] ?? [0, 0, 0]));

  if (loop !== null) {
    out.push(0x21, 0xff, 11);
    ascii("NETSCAPE2.0");
    out.push(3, 1);
    u16(loop);
    out.push(0);
  }

  for (const f of frames) {
    // Graphic Control Extension: disposal 1, без прозрачности.
    out.push(0x21, 0xf9, 4, 1 << 2);
    u16(Math.max(0, Math.round(f.delayCs)));
    out.push(0, 0);
    // Image Descriptor без локальной палитры.
    out.push(0x2c);
    const r = f.rect ?? { left: 0, top: 0, width, height };
    u16(r.left);
    u16(r.top);
    u16(r.width);
    u16(r.height);
    out.push(0);
    out.push(minCode);
    const data = lzw(f.pixels, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      out.push(chunk.length);
      for (const b of chunk) out.push(b);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

function lzw(pixels: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const bytes: number[] = [];
  let buf = 0;
  let cnt = 0;
  let codeSize = minCode + 1;
  const emit = (code: number) => {
    buf |= code << cnt;
    cnt += codeSize;
    while (cnt >= 8) {
      bytes.push(buf & 255);
      buf >>>= 8;
      cnt -= 8;
    }
  };

  let table = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      table.set(key, next++);
      // Декодер увеличивает размер кода, когда заполнит 2^size записей.
      if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      codeSize = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (cnt > 0) bytes.push(buf & 255);
  return Uint8Array.from(bytes);
}
