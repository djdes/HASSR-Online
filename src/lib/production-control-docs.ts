/**
 * Документы раздела «Производственный контроль»: сама программа (ППК) и
 * ХАССП-план. Хранятся как документы базы знаний с полем `kind` — по
 * одному каждого вида на организацию — и в общем списке «Инструкций» не
 * показываются: у них своё место на странице `/production-control`.
 */

import { knowledgeFileType } from "@/lib/knowledge-documents";

export const PRODUCTION_DOC_KINDS = ["ppk", "haccp_plan"] as const;
export type ProductionDocKind = (typeof PRODUCTION_DOC_KINDS)[number];

export function isProductionDocKind(value: unknown): value is ProductionDocKind {
  return typeof value === "string" && (PRODUCTION_DOC_KINDS as readonly string[]).includes(value);
}

/** Платная услуга, которая делает этот документ за клиента (`lib/services/constants.ts`). */
export function productionDocServiceKey(kind: ProductionDocKind): string {
  return kind === "ppk" ? "ppk-development" : "haccp-package";
}

const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

export const PRODUCTION_DOC_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";

/** Тип файла по расширению и сигнатуре; архивы и таблицы не принимаем. */
export function productionDocFileType(fileName: string, bytes: Uint8Array): string | null {
  const type = knowledgeFileType(fileName, bytes);
  return type && DOCUMENT_TYPES.has(type) ? type : null;
}
