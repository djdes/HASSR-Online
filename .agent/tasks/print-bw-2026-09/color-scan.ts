/**
 * Сканер цвета печатных документов (задача print-bw-2026-09).
 *
 * PDF, два независимых признака:
 *   1. Операторы цвета в контент-потоках страниц (и в Form XObject):
 *      `rg/RG` (3 компоненты), `k/K` (CMYK), `sc/scn/SC/SCN` (по числу
 *      компонент), `g/G` — серый. «Цветной» — компоненты RGB не равны
 *      (строго, без допуска; CMYK — есть C, M или Y). Для каждого цветного
 *      оператора ищется, ЧТО им нарисовано (заливка/обводка пути, текст): по
 *      контент-потоку считается геометрия (CTM, пути, матрица текста). Оператор,
 *      всё нарисованное которым лежит внутри плитки QR (+0,6 мм), — «в QR»,
 *      без отрисовки — «не использован» (на бумагу не попадает), иначе —
 *      «вне QR» (это и есть цвет на бумаге).
 *   2. Растр pdf.js (72 dpi): пиксели с хромой max(R,G,B) − min(R,G,B) > 6 вне
 *      плитки QR (+1 мм) — «цветные»; > 24 — «заметно цветные».
 * DOCX: все XML-части — `w:color`, `w:fill`/`w:shd`, `w:highlight`,
 * `w:themeColor`/`w:themeFill`, `a:srgbClr` и т. п. с неравными RGB.
 *
 * Модуль только читает PDF/DOCX; зависимости — pdf-lib, pdfjs-dist,
 * @napi-rs/canvas, jszip (уже есть в node_modules проекта).
 */
import JSZip from "jszip";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";

import { openPdf, renderRegion, type Raster } from "../journal-qr-header-2026-09/qr-sim";

export type BoxMm = { x0: number; y0: number; x1: number; y1: number };
/** Зоны исключения по страницам (1-based) — плитки QR. */
export type ExcludeMap = Map<number, BoxMm[]>;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  // m × n (PDF: строка-вектор, [x y 1] × m × n)
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

// ---------------------------------------------------------------------------
// Токенизатор контент-потока
// ---------------------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; v: string }
  | { t: "arr"; v: Token[] }
  | { t: "dict" }
  | { t: "op"; v: string };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

class Lexer {
  i = 0;
  constructor(private readonly s: Uint8Array) {}

  private skipWs() {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (WS.has(c)) {
        this.i += 1;
      } else if (c === 0x25) {
        while (this.i < s.length && s[this.i] !== 0x0a && s[this.i] !== 0x0d) this.i += 1;
      } else break;
    }
  }

  private regular(): string {
    const s = this.s;
    const start = this.i;
    while (this.i < s.length && !WS.has(s[this.i]) && !DELIM.has(s[this.i])) this.i += 1;
    return String.fromCharCode(...s.subarray(start, this.i));
  }

  private literalString(): string {
    // после «(»
    const s = this.s;
    let depth = 1;
    const out: number[] = [];
    while (this.i < s.length && depth > 0) {
      const c = s[this.i];
      if (c === 0x5c) {
        out.push(c, s[this.i + 1] ?? 0);
        this.i += 2;
        continue;
      }
      if (c === 0x28) depth += 1;
      if (c === 0x29) depth -= 1;
      if (depth > 0) out.push(c);
      this.i += 1;
    }
    return String.fromCharCode(...out.slice(0, 64));
  }

  /** Пропуск встроенной картинки BI … ID <данные> EI. */
  skipInlineImage() {
    const s = this.s;
    // до «ID»
    while (this.i < s.length - 1) {
      if (s[this.i] === 0x49 && s[this.i + 1] === 0x44 && (this.i === 0 || WS.has(s[this.i - 1])) && WS.has(s[this.i + 2] ?? 0x20)) {
        this.i += 3;
        break;
      }
      this.i += 1;
    }
    while (this.i < s.length - 1) {
      if (s[this.i] === 0x45 && s[this.i + 1] === 0x49 && WS.has(s[this.i - 1]) && (this.i + 2 >= s.length || WS.has(s[this.i + 2]))) {
        this.i += 2;
        return;
      }
      this.i += 1;
    }
  }

  next(): Token | null {
    this.skipWs();
    const s = this.s;
    if (this.i >= s.length) return null;
    const c = s[this.i];
    if (c === 0x2f) {
      this.i += 1;
      return { t: "name", v: this.regular() };
    }
    if (c === 0x28) {
      this.i += 1;
      return { t: "str", v: this.literalString() };
    }
    if (c === 0x3c) {
      if (s[this.i + 1] === 0x3c) {
        // словарь: пропускаем до парного «>>»
        let depth = 0;
        while (this.i < s.length) {
          if (s[this.i] === 0x3c && s[this.i + 1] === 0x3c) {
            depth += 1;
            this.i += 2;
          } else if (s[this.i] === 0x3e && s[this.i + 1] === 0x3e) {
            depth -= 1;
            this.i += 2;
            if (depth === 0) break;
          } else if (s[this.i] === 0x28) {
            this.i += 1;
            this.literalString();
          } else this.i += 1;
        }
        return { t: "dict" };
      }
      const start = ++this.i;
      while (this.i < s.length && s[this.i] !== 0x3e) this.i += 1;
      this.i += 1;
      return { t: "str", v: `<${String.fromCharCode(...s.subarray(start, Math.min(this.i - 1, start + 64)))}>` };
    }
    if (c === 0x5b) {
      this.i += 1;
      const items: Token[] = [];
      for (;;) {
        this.skipWs();
        if (this.i >= s.length) break;
        if (s[this.i] === 0x5d) {
          this.i += 1;
          break;
        }
        const tok = this.next();
        if (!tok) break;
        items.push(tok);
      }
      return { t: "arr", v: items };
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.i += 1;
      return this.next();
    }
    const word = this.regular();
    if (word.length === 0) {
      this.i += 1;
      return this.next();
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: parseFloat(word) };
    return { t: "op", v: word };
  }
}

// ---------------------------------------------------------------------------
// Интерпретатор: цвет + геометрия
// ---------------------------------------------------------------------------

type Use = { kind: "fill" | "stroke" | "text" | "shading"; box: BoxMm };

export type ColorOpRecord = {
  page: number;
  op: string;
  comps: number[];
  /** Хрома, доли 0..1 (max − min компонент). */
  chroma: number;
  uses: Use[];
};

type Paint = { colored: ColorOpRecord | null };

type GState = {
  ctm: Matrix;
  fill: Paint;
  stroke: Paint;
  fillSpace: string;
  strokeSpace: string;
  fontSize: number;
  leading: number;
  renderMode: number;
};

const PT_TO_MM = 25.4 / 72;

type ScanContext = {
  doc: PDFDocument;
  page: number;
  pageHeightPt: number;
  records: ColorOpRecord[];
  images: Array<{ page: number; box: BoxMm }>;
  shadings: number;
  unknownSpaces: Set<string>;
};

function numbers(stack: Token[], n: number): number[] {
  const out: number[] = [];
  for (let k = stack.length - n; k < stack.length; k += 1) {
    const tok = stack[k];
    out.push(tok && tok.t === "num" ? tok.v : 0);
  }
  return out;
}

function rgbRecord(ctx: ScanContext, op: string, comps: number[]): ColorOpRecord | null {
  let r: number, g: number, b: number;
  if (comps.length === 1) return null;
  if (comps.length === 3) [r, g, b] = comps;
  else if (comps.length === 4) {
    const [c, m, y] = comps;
    if (c === 0 && m === 0 && y === 0) return null;
    // CMYK → приблизительный RGB для хромы
    const k = comps[3];
    r = (1 - c) * (1 - k);
    g = (1 - m) * (1 - k);
    b = (1 - y) * (1 - k);
  } else return null;
  if (r === g && g === b) return null;
  const record: ColorOpRecord = {
    page: ctx.page,
    op,
    comps,
    chroma: Math.max(r, g, b) - Math.min(r, g, b),
    uses: [],
  };
  ctx.records.push(record);
  return record;
}

function toMmBox(ctx: ScanContext, pts: Array<[number, number]>): BoxMm | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return {
    x0: x0 * PT_TO_MM,
    x1: x1 * PT_TO_MM,
    y0: (ctx.pageHeightPt - y1) * PT_TO_MM,
    y1: (ctx.pageHeightPt - y0) * PT_TO_MM,
  };
}

function lookup(doc: PDFDocument, obj: unknown): unknown {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

function streamBytes(stream: unknown): Uint8Array | null {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream instanceof PDFStream) {
    const s = stream as unknown as { getContents?: () => Uint8Array; getUnencodedContents?: () => Uint8Array };
    return s.getUnencodedContents?.() ?? s.getContents?.() ?? null;
  }
  return null;
}

function interpret(ctx: ScanContext, bytes: Uint8Array, resources: PDFDict | undefined, initial: GState, depth: number) {
  const lexer = new Lexer(bytes);
  const stack: Token[] = [];
  let gs: GState = { ...initial };
  const saved: GState[] = [];
  let path: Array<[number, number]> = [];
  let cur: [number, number] = [0, 0];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;

  const addUse = (paint: Paint, kind: Use["kind"], box: BoxMm | null) => {
    if (paint.colored && box) paint.colored.uses.push({ kind, box });
  };
  const paintPath = (fill: boolean, stroke: boolean) => {
    const box = toMmBox(ctx, path);
    if (fill) addUse(gs.fill, "fill", box);
    if (stroke) addUse(gs.stroke, "stroke", box);
    path = [];
  };
  const showText = () => {
    if (gs.renderMode === 3 || gs.renderMode === 7) return;
    const m = mul(tm, gs.ctm);
    const origin = apply(m, 0, 0);
    const top = apply(m, 0, gs.fontSize * 0.8);
    const box = toMmBox(ctx, [origin, top]);
    const fills = gs.renderMode === 0 || gs.renderMode === 2 || gs.renderMode === 4 || gs.renderMode === 6;
    const strokes = gs.renderMode === 1 || gs.renderMode === 2 || gs.renderMode === 5 || gs.renderMode === 6;
    if (fills) addUse(gs.fill, "text", box);
    if (strokes) addUse(gs.stroke, "text", box);
  };
  const setColor = (which: "fill" | "stroke", op: string, comps: number[]) => {
    const record = rgbRecord(ctx, op, comps);
    if (which === "fill") gs.fill = { colored: record };
    else gs.stroke = { colored: record };
  };
  const spaceComps = (space: string, fallback: number): number => {
    if (space === "DeviceGray" || space === "CalGray" || space === "G") return 1;
    if (space === "DeviceRGB" || space === "CalRGB" || space === "RGB") return 3;
    if (space === "DeviceCMYK" || space === "CMYK") return 4;
    if (space === "Pattern") return 0;
    // Именованное пространство ресурса (ICCBased и т. п.) — по /N
    const csDict = resources ? lookup(ctx.doc, resources.get(PDFName.of("ColorSpace"))) : undefined;
    if (csDict instanceof PDFDict) {
      const entry = lookup(ctx.doc, csDict.get(PDFName.of(space)));
      if (entry instanceof PDFArray) {
        const kind = lookup(ctx.doc, entry.get(0));
        const kindName = kind instanceof PDFName ? kind.asString().slice(1) : "";
        if (kindName === "ICCBased") {
          const stream = lookup(ctx.doc, entry.get(1)) as { dict?: PDFDict } | undefined;
          const n = stream?.dict ? lookup(ctx.doc, stream.dict.get(PDFName.of("N"))) : undefined;
          if (n instanceof PDFNumber) return n.asNumber();
        }
        if (kindName === "Pattern") return 0;
        if (kindName === "DeviceRGB" || kindName === "CalRGB" || kindName === "Lab") return 3;
        if (kindName === "DeviceGray" || kindName === "CalGray") return 1;
        if (kindName === "DeviceCMYK") return 4;
        if (kindName === "Separation" || kindName === "Indexed") ctx.unknownSpaces.add(`${space}:${kindName}`);
      }
    }
    return fallback;
  };

  for (let tok = lexer.next(); tok; tok = lexer.next()) {
    if (tok.t !== "op") {
      stack.push(tok);
      continue;
    }
    const op = tok.v;
    switch (op) {
      case "q":
        saved.push({ ...gs });
        break;
      case "Q":
        gs = saved.pop() ?? gs;
        break;
      case "cm": {
        const [a, b, c, d, e, f] = numbers(stack, 6);
        gs.ctm = mul([a, b, c, d, e, f], gs.ctm);
        break;
      }
      case "m": {
        const [x, y] = numbers(stack, 2);
        cur = apply(gs.ctm, x, y);
        path.push(cur);
        break;
      }
      case "l": {
        const [x, y] = numbers(stack, 2);
        cur = apply(gs.ctm, x, y);
        path.push(cur);
        break;
      }
      case "c": {
        const v = numbers(stack, 6);
        path.push(apply(gs.ctm, v[0], v[1]), apply(gs.ctm, v[2], v[3]));
        cur = apply(gs.ctm, v[4], v[5]);
        path.push(cur);
        break;
      }
      case "v":
      case "y": {
        const v = numbers(stack, 4);
        path.push(apply(gs.ctm, v[0], v[1]));
        cur = apply(gs.ctm, v[2], v[3]);
        path.push(cur);
        break;
      }
      case "re": {
        const [x, y, w, h] = numbers(stack, 4);
        path.push(apply(gs.ctm, x, y), apply(gs.ctm, x + w, y), apply(gs.ctm, x, y + h), apply(gs.ctm, x + w, y + h));
        break;
      }
      case "h":
        break;
      case "S":
      case "s":
        paintPath(false, true);
        break;
      case "f":
      case "F":
      case "f*":
        paintPath(true, false);
        break;
      case "B":
      case "B*":
      case "b":
      case "b*":
        paintPath(true, true);
        break;
      case "n":
        path = [];
        break;
      case "W":
      case "W*":
        break;
      case "g":
        gs.fill = { colored: null };
        gs.fillSpace = "DeviceGray";
        break;
      case "G":
        gs.stroke = { colored: null };
        gs.strokeSpace = "DeviceGray";
        break;
      case "rg":
        gs.fillSpace = "DeviceRGB";
        setColor("fill", op, numbers(stack, 3));
        break;
      case "RG":
        gs.strokeSpace = "DeviceRGB";
        setColor("stroke", op, numbers(stack, 3));
        break;
      case "k":
        gs.fillSpace = "DeviceCMYK";
        setColor("fill", op, numbers(stack, 4));
        break;
      case "K":
        gs.strokeSpace = "DeviceCMYK";
        setColor("stroke", op, numbers(stack, 4));
        break;
      case "cs":
      case "CS": {
        const name = stack[stack.length - 1];
        const space = name && name.t === "name" ? name.v : "DeviceGray";
        if (op === "cs") {
          gs.fillSpace = space;
          gs.fill = { colored: null };
        } else {
          gs.strokeSpace = space;
          gs.stroke = { colored: null };
        }
        break;
      }
      case "sc":
      case "scn":
      case "SC":
      case "SCN": {
        const fill = op === "sc" || op === "scn";
        const space = fill ? gs.fillSpace : gs.strokeSpace;
        const nums = stack.filter((t) => t.t === "num").length;
        const hasPattern = stack.some((t) => t.t === "name");
        let n = spaceComps(space, nums);
        if (hasPattern || n === 0) {
          // Узор/шейдинг: цвет внутри — считаем по растру.
          const record: ColorOpRecord = { page: ctx.page, op: `${op}(pattern)`, comps: [], chroma: 1, uses: [] };
          ctx.records.push(record);
          if (fill) gs.fill = { colored: record };
          else gs.stroke = { colored: record };
          break;
        }
        n = Math.min(n, nums);
        setColor(fill ? "fill" : "stroke", op, numbers(stack, n));
        break;
      }
      case "sh":
        ctx.shadings += 1;
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "ET":
        break;
      case "Tf": {
        const size = stack[stack.length - 1];
        if (size && size.t === "num") gs.fontSize = size.v;
        break;
      }
      case "TL": {
        const [l] = numbers(stack, 1);
        gs.leading = l;
        break;
      }
      case "Tr": {
        const [mode] = numbers(stack, 1);
        gs.renderMode = mode;
        break;
      }
      case "Td":
      case "TD": {
        const [tx, ty] = numbers(stack, 2);
        if (op === "TD") gs.leading = -ty;
        tlm = mul([1, 0, 0, 1, tx, ty], tlm);
        tm = tlm;
        break;
      }
      case "Tm": {
        const [a, b, c, d, e, f] = numbers(stack, 6);
        tlm = [a, b, c, d, e, f];
        tm = tlm;
        break;
      }
      case "T*":
        tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
        tm = tlm;
        break;
      case "Tj":
      case "TJ":
        showText();
        break;
      case "'":
      case '"':
        tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
        tm = tlm;
        showText();
        break;
      case "BI":
        lexer.skipInlineImage();
        break;
      case "Do": {
        const name = stack[stack.length - 1];
        if (!name || name.t !== "name" || !resources) break;
        const xobjects = lookup(ctx.doc, resources.get(PDFName.of("XObject")));
        if (!(xobjects instanceof PDFDict)) break;
        const xobj = lookup(ctx.doc, xobjects.get(PDFName.of(name.v)));
        if (!(xobj instanceof PDFRawStream || xobj instanceof PDFStream)) break;
        const dict = (xobj as unknown as { dict: PDFDict }).dict;
        const subtype = lookup(ctx.doc, dict.get(PDFName.of("Subtype")));
        const subtypeName = subtype instanceof PDFName ? subtype.asString() : "";
        if (subtypeName === "/Image") {
          const corners = [apply(gs.ctm, 0, 0), apply(gs.ctm, 1, 0), apply(gs.ctm, 0, 1), apply(gs.ctm, 1, 1)];
          const box = toMmBox(ctx, corners);
          if (box) ctx.images.push({ page: ctx.page, box });
        } else if (subtypeName === "/Form" && depth < 8) {
          const matrixObj = lookup(ctx.doc, dict.get(PDFName.of("Matrix")));
          let matrix: Matrix = IDENTITY;
          if (matrixObj instanceof PDFArray && matrixObj.size() === 6) {
            matrix = [0, 1, 2, 3, 4, 5].map((k) => (lookup(ctx.doc, matrixObj.get(k)) as PDFNumber).asNumber()) as Matrix;
          }
          const formRes = lookup(ctx.doc, dict.get(PDFName.of("Resources")));
          const bytesForm = streamBytes(xobj);
          if (bytesForm) {
            interpret(ctx, bytesForm, formRes instanceof PDFDict ? formRes : resources, { ...gs, ctm: mul(matrix, gs.ctm) }, depth + 1);
          }
        }
        break;
      }
      default:
        break;
    }
    stack.length = 0;
  }
}

export type PdfOpScan = {
  pages: number;
  /** Все операторы с неравными компонентами. */
  coloredOps: number;
  /** Нарисовано ими что-то вне плитки QR — цвет на бумаге. */
  coloredOutsideQr: number;
  coloredInQr: number;
  coloredUnused: number;
  shadings: number;
  images: Array<{ page: number; box: BoxMm }>;
  examples: Array<{ page: number; op: string; comps: number[]; box: BoxMm | null }>;
  /** Уникальные цвета вне QR: «r,g,b» → число операторов. */
  palette: Record<string, number>;
};

function inside(box: BoxMm, zones: BoxMm[], pad: number): boolean {
  return zones.some((z) => box.x0 >= z.x0 - pad && box.x1 <= z.x1 + pad && box.y0 >= z.y0 - pad && box.y1 <= z.y1 + pad);
}

export async function scanPdfOperators(buffer: Uint8Array, exclude: ExcludeMap = new Map()): Promise<PdfOpScan> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const records: ColorOpRecord[] = [];
  const ctx: ScanContext = { doc, page: 0, pageHeightPt: 0, records, images: [], shadings: 0, unknownSpaces: new Set() };
  pages.forEach((page, index) => {
    ctx.page = index + 1;
    ctx.pageHeightPt = page.getHeight();
    const contents = page.node.Contents();
    const parts: Uint8Array[] = [];
    if (contents instanceof PDFArray) {
      for (let k = 0; k < contents.size(); k += 1) {
        const b = streamBytes(lookup(doc, contents.get(k)));
        if (b) parts.push(b);
      }
    } else if (contents) {
      const b = streamBytes(contents);
      if (b) parts.push(b);
    }
    // Потоки страницы — один поток, разделённый пробелом.
    const total = parts.reduce((s, p) => s + p.length + 1, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
      bytes[offset] = 0x0a;
      offset += 1;
    }
    const resources = page.node.Resources();
    interpret(
      ctx,
      bytes,
      resources,
      {
        ctm: IDENTITY,
        fill: { colored: null },
        stroke: { colored: null },
        fillSpace: "DeviceGray",
        strokeSpace: "DeviceGray",
        fontSize: 10,
        leading: 0,
        renderMode: 0,
      },
      0,
    );
  });

  let outside = 0;
  let inQr = 0;
  let unused = 0;
  const examples: PdfOpScan["examples"] = [];
  const palette: Record<string, number> = {};
  for (const r of records) {
    if (r.uses.length === 0) {
      unused += 1;
      continue;
    }
    const zones = exclude.get(r.page) ?? [];
    const allInQr = zones.length > 0 && r.uses.every((u) => inside(u.box, zones, 0.6));
    if (allInQr) {
      inQr += 1;
      continue;
    }
    outside += 1;
    const key = r.comps.length ? r.comps.map((c) => Math.round(c * 255)).join(",") : r.op;
    palette[key] = (palette[key] ?? 0) + 1;
    if (examples.length < 6) {
      const u = r.uses.find((x) => !inside(x.box, zones, 0.6)) ?? r.uses[0];
      examples.push({
        page: r.page,
        op: r.op,
        comps: r.comps.map((c) => +c.toFixed(3)),
        box: u ? { x0: +u.box.x0.toFixed(1), y0: +u.box.y0.toFixed(1), x1: +u.box.x1.toFixed(1), y1: +u.box.y1.toFixed(1) } : null,
      });
    }
  }
  return {
    pages: pages.length,
    coloredOps: records.length,
    coloredOutsideQr: outside,
    coloredInQr: inQr,
    coloredUnused: unused,
    shadings: ctx.shadings,
    images: ctx.images,
    examples,
    palette,
  };
}

// ---------------------------------------------------------------------------
// Растр
// ---------------------------------------------------------------------------

export type PdfRasterScan = {
  dpi: number;
  pixels: number;
  /** Хрома > 6 из 255 вне QR. */
  colored: number;
  /** Хрома > 24 из 255 вне QR. */
  coloredVisible: number;
  pagesWithColor: number[];
};

export const RASTER_DPI = 72;
let rasterPages = 0;

export async function scanPdfRaster(
  buffer: Uint8Array,
  exclude: ExcludeMap = new Map(),
  dpi = RASTER_DPI,
  onPage?: (page: number, raster: Raster) => void | Promise<void>,
): Promise<PdfRasterScan> {
  const doc = await openPdf(Buffer.from(buffer));
  const k = dpi / 25.4;
  let pixels = 0;
  let colored = 0;
  let visible = 0;
  const pagesWithColor: number[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const size = { width: (vp.width / 72) * 25.4, height: (vp.height / 72) * 25.4 };
      const raster = await renderRegion(doc, p, { x0: 0, y0: 0, x1: size.width, y1: size.height }, dpi);
      const zones = (exclude.get(p) ?? []).map((z) => ({ x0: (z.x0 - 1) * k, y0: (z.y0 - 1) * k, x1: (z.x1 + 1) * k, y1: (z.y1 + 1) * k }));
      let pageColored = 0;
      const d = raster.data;
      for (let y = 0; y < raster.height; y += 1) {
        for (let x = 0; x < raster.width; x += 1) {
          const i = (y * raster.width + x) * 4;
          const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
          pixels += 1;
          if (chroma <= 6) continue;
          if (zones.some((z) => x + 0.5 >= z.x0 && x + 0.5 <= z.x1 && y + 0.5 >= z.y0 && y + 0.5 <= z.y1)) continue;
          colored += 1;
          pageColored += 1;
          if (chroma > 24) visible += 1;
        }
      }
      if (pageColored > 0) pagesWithColor.push(p);
      if (onPage) await onPage(p, raster);
      // Холсты @napi-rs/canvas — нативная память, сборщик её не видит:
      // без явной сборки процесс на тысяче страниц разрастался до 5+ ГБ.
      rasterPages += 1;
      const gc = (globalThis as { gc?: () => void }).gc;
      if (gc && rasterPages % 20 === 0) gc();
    }
  } finally {
    await doc.close();
  }
  return { dpi, pixels, colored, coloredVisible: visible, pagesWithColor };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

export type DocxScan = {
  parts: number;
  /** Цветные атрибуты по частям: «word/styles.xml» → список. */
  colored: Array<{ part: string; attr: string; value: string }>;
  themeRefs: Array<{ part: string; attr: string; value: string }>;
};

const HEX = /^[0-9A-Fa-f]{6}$/;

function hexColored(value: string): boolean {
  if (!HEX.test(value)) return false;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return !(r === g && g === b);
}

/** Имена подсветки Word, которые не серые. */
const GRAY_HIGHLIGHTS = new Set(["none", "black", "white", "lightGray", "darkGray"]);

export async function scanDocx(buffer: Uint8Array): Promise<DocxScan> {
  const zip = await JSZip.loadAsync(buffer);
  const colored: DocxScan["colored"] = [];
  const themeRefs: DocxScan["themeRefs"] = [];
  let parts = 0;
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith(".xml") || zip.files[name].dir) continue;
    // Палитра темы (a:clrScheme) — определения, а не применение: считаем
    // только ссылки на неё (themeColor/themeFill) в остальных частях.
    const isTheme = name.startsWith("word/theme/");
    parts += 1;
    const xml = await zip.files[name].async("string");
    if (isTheme) continue;
    const attrRe = /\b(w:color|w:fill|w:val|val|w:themeColor|w:themeFill|w:themeShade|w:themeTint)="([^"]*)"/g;
    // Проверяем атрибуты в контексте их элементов.
    const elementRe = /<(w:color|w:shd|w:highlight|a:srgbClr|w:top|w:bottom|w:left|w:right|w:insideH|w:insideV|w:start|w:end|w:bdr|w:u|v:fill|v:stroke)\b([^>]*)\/?>/g;
    for (const match of xml.matchAll(elementRe)) {
      const tag = match[1];
      const attrs = match[2];
      for (const a of attrs.matchAll(attrRe)) {
        const attr = a[1];
        const value = a[2];
        if (attr === "w:themeColor" || attr === "w:themeFill") {
          themeRefs.push({ part: name, attr: `${tag}@${attr}`, value });
          continue;
        }
        if (tag === "w:highlight" && attr === "w:val") {
          if (!GRAY_HIGHLIGHTS.has(value)) colored.push({ part: name, attr: `${tag}@${attr}`, value });
          continue;
        }
        if ((attr === "w:color" || attr === "w:fill" || attr === "w:val" || attr === "val") && hexColored(value)) {
          colored.push({ part: name, attr: `${tag}@${attr}`, value });
        }
      }
    }
  }
  return { parts, colored, themeRefs };
}
