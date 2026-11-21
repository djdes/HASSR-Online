/**
 * Строка во входящих (прехедер) и текстовая версия писем — чистые функции
 * поверх HTML общего шаблона (спека emails-preheader-text-root-catalog-2026-11-21).
 *
 * Рядом с темой почта показывает начало текста письма: без прехедера это
 * было «wesetup.ru» из шапки и повтор темы. А текстовую часть получали только
 * письма, которым её собрали вручную, — остальные уходили одним HTML.
 */

/**
 * Невидимое заполнение после прехедера: без него почта дописывает в строку
 * следующий текст письма («wesetup.ru», заголовок).
 */
export const PREHEADER_FILLER = "&zwnj;&nbsp;".repeat(90);

const PREHEADER_MAX = 110;
/** Короче этого строка склеивается со следующей: «Ваш код:» + «481 205». */
const PREHEADER_MIN = 40;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  minus: "−",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  bull: "•",
  middot: "·",
  rarr: "→",
  larr: "←",
  times: "×",
  deg: "°",
  euro: "€",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  zwnj: "",
  zwj: "",
  shy: "",
};

/** Невидимые символы заполнения и мягкие переносы — в тексте не нужны. */
const INVISIBLE = /[­͏​-‍ ⁠﻿]/g;

export function decodeEmailEntities(value: string): string {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#")) {
        const point = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(INVISIBLE, "")
    .replace(/ /g, " ");
}

const GREETING = /^(здравствуйте|добрый\s+(день|вечер)|доброе\s+утро|привет|hello|hi|dear|good\s+(morning|afternoon|evening)|assalomu\s+alaykum|salom)(?=[\s,!.]|$)/i;

function isGreeting(line: string): boolean {
  return line.length <= 60 && GREETING.test(line);
}

function joinLines(first: string, second: string): string {
  // После «:», запятой или тире — продолжение фразы; иначе — новое предложение.
  if (/[:;,—–-]$/.test(first) || /[.!?…]$/.test(first)) return `${first} ${second}`;
  return `${first}. ${second}`;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,.;:—–-]+$/, "")}…`;
}

/** Строки текста по блокам разметки: абзац, строка таблицы, пункт списка. */
function blockLines(html: string): string[] {
  const text = html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div[^>]*display:\s*none[\s\S]*?<\/div>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr|td|th|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEmailEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Прехедер из тела письма: первая содержательная фраза без приветствия
 * («Здравствуйте, Анна!»), короткие подписи склеиваются со следующей
 * строкой, не длиннее 110 знаков. Нет текста — `null`.
 */
export function emailPreheaderFromBody(bodyHtml: string, max = PREHEADER_MAX): string | null {
  const lines = blockLines(bodyHtml);
  let index = 0;
  while (index < lines.length && isGreeting(lines[index])) index += 1;
  if (index >= lines.length) return null;
  let text = lines[index];
  index += 1;
  // Короткая подпись или строка с двоеточием продолжается следующей строкой.
  while ((text.length < PREHEADER_MIN || text.endsWith(":")) && index < lines.length) {
    text = joinLines(text, lines[index]);
    index += 1;
  }
  return clip(text, max);
}

/** Прехедер готового письма — как его покажет почта, без заполнения. */
export function emailPreheaderFromHtml(html: string): string | null {
  const body = html.slice(Math.max(0, html.indexOf("<body")));
  const match = body.match(/<div[^>]*display:\s*none[^>]*>([\s\S]*?)<\/div>/i);
  if (!match) return null;
  const text = decodeEmailEntities(match[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return text || null;
}

function sameAddress(label: string, href: string): boolean {
  const normalize = (value: string) => value.replace(/^(https?:\/\/|mailto:|tel:)/i, "").replace(/\/$/, "").trim().toLowerCase();
  return normalize(label) === normalize(href);
}

/**
 * Текстовая версия письма из HTML: абзацы через пустую строку, пункты
 * списков «• », ссылки «текст: адрес» (почта и телефон — как есть), без
 * скрытого прехедера, картинок, стилей и разметки.
 */
export function emailHtmlToText(html: string): string {
  const withLinks = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div[^>]*display:\s*none[\s\S]*?<\/div>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_whole, rawHref: string, inner: string) => {
      const label = decodeEmailEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      const href = decodeEmailEntities(rawHref).trim();
      if (!href || href.startsWith("#")) return label;
      const contact = /^(mailto|tel):/i.test(href);
      const bare = href.replace(/^(mailto|tel):/i, "");
      if (!label) return bare;
      if (sameAddress(label, href)) return label;
      if (contact) return label.includes(bare) ? label : `${label} (${bare})`;
      return `${label}: ${href}`;
    });
  const text = withLinks
    // Блок начинается с новой строки: кнопка-ссылка перед абзацем не слипается с ним.
    .replace(/<(p|h[1-6]|ul|ol|blockquote|table)\b[^>]*>/gi, "\n\n")
    .replace(/<(div|tr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|ul|ol|blockquote)>/gi, "\n\n")
    .replace(/<\/(div|tr|table)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEmailEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
