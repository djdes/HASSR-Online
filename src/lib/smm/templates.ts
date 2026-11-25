/**
 * Шаблоны картинок постов (A23, B29) — описание без рисования: какие поля
 * нужны, размер и разбивка заголовка на строки. Рисует `render.server.ts`.
 */

export type TemplateKey = "photo-band" | "photo-frame" | "card" | "promo";

export interface TemplateDef {
  key: TemplateKey;
  label: string;
  description: string;
  width: number;
  height: number;
  needsPhoto: boolean;
  fields: Array<"title" | "subtitle" | "rubric" | "offer" | "deadline">;
}

export const TEMPLATES: TemplateDef[] = [
  {
    key: "photo-band",
    label: "Фото с плашкой",
    description: "Фото на весь кадр, снизу затемнение с заголовком, логотип и рубрика.",
    width: 1280,
    height: 960,
    needsPhoto: true,
    fields: ["title", "rubric"],
  },
  {
    key: "photo-frame",
    label: "Фото в рамке",
    description: "Фото в фирменной рамке, заголовок и подзаголовок на светлом поле.",
    width: 1080,
    height: 1350,
    needsPhoto: true,
    fields: ["title", "subtitle", "rubric"],
  },
  {
    key: "card",
    label: "Карточка-факт",
    description: "Фирменный фон без фото: крупный заголовок и пояснение — для советов и цифр.",
    width: 1080,
    height: 1080,
    needsPhoto: false,
    fields: ["title", "subtitle", "rubric"],
  },
  {
    key: "promo",
    label: "Акция",
    description: "Крупная выгода (−15%, 2 недели бесплатно), заголовок, срок; фото справа.",
    width: 1280,
    height: 960,
    needsPhoto: false,
    fields: ["offer", "title", "deadline"],
  },
];

export function findTemplate(key: string | null | undefined): TemplateDef | null {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}

export interface TemplateData {
  title: string;
  subtitle?: string;
  rubric?: string;
  offer?: string;
  deadline?: string;
}

/**
 * Перенос текста по ширине: `measure` — ширина строки в пикселях.
 * Не больше `maxLines` строк; лишнее обрезается многоточием.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const wordsList = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of wordsList) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last.replace(/[,.:;—-]+$/, "")}…`;
  return kept;
}

/** Подбор кегля: самый крупный, при котором заголовок влезает в `maxLines`. */
export function fitFont(
  text: string,
  maxWidth: number,
  measureAt: (s: string, size: number) => number,
  sizes: number[],
  maxLines: number,
): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrapText(text, maxWidth, (s) => measureAt(s, size), Number.MAX_SAFE_INTEGER);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrapText(text, maxWidth, (s) => measureAt(s, size), maxLines) };
}

/** Заголовок картинки из поста: первая строка без разметки, эмодзи и хэштегов. */
export function titleFromPost(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#")) ?? "";
  return line
    .replace(/\*\*|__|`/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}
