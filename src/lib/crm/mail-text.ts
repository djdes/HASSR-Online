/**
 * Текст письма для ленты CRM: без цитаты предыдущей переписки и подписи
 * «-- », с обрезкой по длине. Чистые функции.
 */

import { CRM_BODY_MAX } from "@/lib/crm/constants";

/** Строка, с которой начинается цитата: «On … wrote:», «12.10.2026, 10:00, Иван пишет:», «-----Original Message-----». */
const QUOTE_HEADER = [
  /^on .{3,200} wrote:?\s*$/i,
  /^.{0,120}\d{1,2}[./]\d{1,2}[./]\d{2,4}.{0,160}(пишет|написал\(а\)|написала?|wrote)\s*:?\s*$/i,
  /^.{0,160}(пишет|написал\(а\)|написала?)\s*:\s*$/i,
  /^-{2,}\s*(original message|исходное сообщение|пересылаемое сообщение|forwarded message)\s*-*\s*$/i,
  /^_{5,}\s*$/,
];

/** Блок Outlook «From: … / Sent: …» после пустой строки. */
const OUTLOOK_HEADER = /^(from|от|отправитель)\s*:\s+\S/i;

export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (QUOTE_HEADER.some((pattern) => pattern.test(trimmed))) break;
    if (OUTLOOK_HEADER.test(trimmed) && index > 0 && lines[index - 1].trim() === "" && kept.some((item) => item.trim())) break;
    // Подпись по соглашению «-- » (два дефиса и пробел) — дальше не текст письма.
    if (line === "-- " || line === "--") break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line);
  }
  const result = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Письмо из одной цитаты (переслали без комментария) — лучше показать всё.
  return result || text.trim();
}

export function truncateBody(text: string, max = CRM_BODY_MAX): string {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Грубый HTML → текст для писем без текстовой части. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Одна строка для списка: первые слова без переносов. */
export function previewLine(text: string | null | undefined, max = 140): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
