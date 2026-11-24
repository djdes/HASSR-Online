/**
 * Документы текстом (2026-11-24): рабочие инструкции (база знаний, приложение
 * № 6) и документированные процедуры (папка «Процедуры», приложение № 5) можно
 * не загружать файлом, а написать в кабинете — «текстом с нашими шапками и
 * нумерацией». Хранятся как `KnowledgeDocument` с `text/plain`.
 */
import { z } from "zod";

export const TEXT_DOC_MIME = "text/plain; charset=utf-8";
export const TEXT_DOC_MAX = 60000;
export const TEXT_DOC_TITLE_MAX = 200;

/** Где создаётся документ: база знаний (инструкции) или папка «Процедуры» точки. */
export const TEXT_DOC_SOURCES = ["knowledge", "procedures"] as const;
export type TextDocSource = (typeof TEXT_DOC_SOURCES)[number];

export function isTextDoc(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("text/plain");
}

/** Имя файла для скачивания: название без запрещённых знаков + «.txt». */
export function textDocFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n\t\x00]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "Документ";
  return `${base}.txt`;
}

export const textDocCreateSchema = z.object({
  source: z.enum(TEXT_DOC_SOURCES),
  title: z.string().trim().min(1).max(TEXT_DOC_TITLE_MAX),
  text: z.string().max(TEXT_DOC_MAX).refine((value) => value.trim().length > 0),
});

export const textDocPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(TEXT_DOC_TITLE_MAX).optional(),
    text: z.string().max(TEXT_DOC_MAX).refine((value) => value.trim().length > 0).optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.text !== undefined);
