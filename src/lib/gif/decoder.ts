/**
 * Минимальный декодер GIF — только для тестов кодировщика: разбирает блоки
 * и разворачивает LZW обратно в индексы палитры.
 */
export type DecodedGif = {
  version: string;
  width: number;
  height: number;
  palette: [number, number, number][];
  loop: number | null | undefined;
  /** `pixels` — данные кадра (для его прямоугольника), `full` — итоговое изображение после наложения. */
  frames: { pixels: Uint8Array; delayCs: number; rect: { left: number; top: number; width: number; height: number }; full: Uint8Array }[];
};

function lzwDecode(minCodeSize: number, data: Uint8Array, count: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = new Uint8Array(count);
  let outPos = 0;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
  };
  reset();
  let codeSize = minCodeSize + 1;
  let bitBuf = 0;
  let bitCnt = 0;
  let pos = 0;
  let prev: number[] | null = null;
  while (outPos < count) {
    while (bitCnt < codeSize && pos < data.length) {
      bitBuf |= data[pos++] << bitCnt;
      bitCnt += 8;
    }
    if (bitCnt < codeSize) break;
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitCnt -= codeSize;
    if (code === clear) {
      reset();
      codeSize = minCodeSize + 1;
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error("битый LZW");
    for (const v of entry) if (outPos < count) out[outPos++] = v;
    if (prev) {
      table.push([...prev, entry[0]]);
      if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

export function decodeGif(buf: Buffer): DecodedGif {
  const version = buf.subarray(0, 6).toString("ascii");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const flags = buf[10];
  let p = 13;
  const palette: [number, number, number][] = [];
  if (flags & 0x80) {
    const n = 1 << ((flags & 7) + 1);
    for (let i = 0; i < n; i++, p += 3) palette.push([buf[p], buf[p + 1], buf[p + 2]]);
  }
  let loop: number | null | undefined = null;
  let delay = 0;
  const frames: DecodedGif["frames"] = [];
  const readSub = (): Uint8Array => {
    const chunks: number[] = [];
    for (;;) {
      const len = buf[p++];
      if (len === 0) break;
      for (let i = 0; i < len; i++) chunks.push(buf[p++]);
    }
    return Uint8Array.from(chunks);
  };
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) {
        p++; // размер блока
        p++; // флаги
        delay = buf.readUInt16LE(p);
        p += 2;
        p++; // прозрачный индекс
        p++; // терминатор
      } else if (label === 0xff) {
        const len = buf[p++];
        const id = buf.subarray(p, p + len).toString("ascii");
        p += len;
        const sub = readSub();
        if (id === "NETSCAPE2.0") loop = sub[1] | (sub[2] << 8);
      } else {
        readSub();
      }
    } else if (b === 0x2c) {
      const left = buf.readUInt16LE(p);
      const top = buf.readUInt16LE(p + 2);
      const w = buf.readUInt16LE(p + 4);
      const h = buf.readUInt16LE(p + 6);
      p += 8;
      const lf = buf[p++];
      if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1));
      const min = buf[p++];
      const pixels = lzwDecode(min, readSub(), w * h);
      // Disposal 1: кадр накладывается на предыдущее изображение.
      const full = frames.length ? Uint8Array.from(frames[frames.length - 1].full) : new Uint8Array(width * height);
      for (let y = 0; y < h; y++) full.set(pixels.subarray(y * w, (y + 1) * w), (top + y) * width + left);
      frames.push({ pixels, delayCs: delay, rect: { left, top, width: w, height: h }, full });
    } else {
      throw new Error(`неизвестный блок 0x${b.toString(16)}`);
    }
  }
  return { version, width, height, palette, loop, frames };
}
