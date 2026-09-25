import { z } from "zod";

import {
  normalizeBlankEmail,
  type BlankFormat,
  type BlankTarget,
} from "@/lib/blank-download";
import { DOCX_SAMPLE_CODES } from "@/lib/document-docx";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { paperJournalById } from "@/lib/sphere-journal-rules";

/**
 * Что можно скачать через POST /api/public/blank-download и в каких
 * форматах. Серверный модуль: тянет каталог журналов и список DOCX.
 */

export type BlankTargetInfo = {
  target: BlankTarget;
  title: string;
  formats: BlankFormat[];
};

const DOCX_CODES = new Set<string>(DOCX_SAMPLE_CODES);

export function describeBlankTarget(target: BlankTarget): BlankTargetInfo | null {
  if (target.kind === "paper") {
    const journal = paperJournalById(target.paperId);
    return journal ? { target, title: journal.name, formats: ["pdf"] } : null;
  }
  const item = ACTIVE_JOURNAL_CATALOG.find((journal) => journal.code === target.code);
  if (!item) return null;
  return { target, title: item.name, formats: DOCX_CODES.has(item.code) ? ["pdf", "docx"] : ["pdf"] };
}

const bodySchema = z.object({
  email: z.string().max(400),
  code: z.string().max(64).optional(),
  paperId: z.string().max(64).optional(),
  format: z.enum(["pdf", "docx"]),
  consent: z.literal(true),
  /// Почту подставил браузер (скачивали раньше) — окно не показывали.
  remembered: z.boolean().optional(),
  /// Редакция документов, с которой браузер запомнил согласие.
  consentVersion: z.string().max(32).optional(),
});

export type BlankDownloadRequest = {
  email: string;
  info: BlankTargetInfo;
  format: BlankFormat;
};

export type BlankDownloadParse =
  | { ok: true; value: BlankDownloadRequest }
  | { ok: false; status: 400 | 404 | 409; error: string; needConsent?: true };

/**
 * Разбор тела запроса. Чистая функция — без БД и сети: почта, цель,
 * формат и согласие. Согласие, запомненное браузером со старой редакцией
 * документов, не принимается — окно спросит галку заново (409).
 */
export function parseBlankDownloadRequest(body: unknown, legalVersion: string): BlankDownloadParse {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (raw.consent !== true) {
    return {
      ok: false,
      status: 400,
      error: "Отметьте согласие на обработку персональных данных",
      needConsent: true,
    };
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "Некорректный запрос" };
  const data = parsed.data;

  const email = normalizeBlankEmail(data.email);
  if (!email) return { ok: false, status: 400, error: "Укажите корректный адрес электронной почты" };

  if (Boolean(data.code) === Boolean(data.paperId)) {
    return { ok: false, status: 400, error: "Не указан шаблон" };
  }
  const target: BlankTarget = data.code
    ? { kind: "code", code: data.code }
    : { kind: "paper", paperId: data.paperId as string };
  const info = describeBlankTarget(target);
  if (!info) return { ok: false, status: 404, error: "Такого шаблона нет" };
  if (!info.formats.includes(data.format)) {
    return { ok: false, status: 400, error: "Этот шаблон есть только в PDF" };
  }

  if (data.remembered && data.consentVersion !== legalVersion) {
    return {
      ok: false,
      status: 409,
      error: "Документы обновились — подтвердите согласие ещё раз",
      needConsent: true,
    };
  }
  return { ok: true, value: { email, info, format: data.format } };
}
