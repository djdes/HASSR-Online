import { NORM_CATALOG } from "@/lib/ppk/norm-catalog";
import type { DocVersion, NormsData } from "@/lib/ppk/records";
import { latestDocVersion } from "@/lib/ppk/review";

/**
 * «Нормативка» раздела «Пришла проверка» и портала проверяющего: ППК и
 * ХАССП-план (собранные из разделов и загруженные файлы) плюс перечень
 * нормативных документов. Только чтение. Чистые расчёты — здесь, выборка
 * из БД — `inspection-norms.server.ts`.
 */

export type InspectionNormDoc = "ppk" | "haccp-plan";

export type InspectionNorms = {
  /** Загруженные файлы `KnowledgeDocument` видов `ppk` / `haccp_plan`. */
  uploaded: Record<InspectionNormDoc, { fileName: string; updatedAt: string } | null>;
  /** Последняя утверждённая версия (из блока «Версии документов»). */
  approvals: Record<InspectionNormDoc, { version: number; approvedAt: string } | null>;
  /** Названия нормативных документов. */
  norms: string[];
  /** org — отмечены заведением; recommended — заведение ещё не отмечало, показываем основные. */
  normsSource: "org" | "recommended";
};

/** Перечень норм: отмеченные заведением (каталог + свои), иначе — рекомендуемые из каталога. */
export function resolveNormTitles(data: NormsData | null): { norms: string[]; source: "org" | "recommended" } {
  const own = data
    ? [
        ...NORM_CATALOG.filter((doc) => data.selected.includes(doc.id)).map((doc) => doc.title),
        ...data.custom.map((doc) => doc.title),
      ]
    : [];
  if (own.length > 0) return { norms: own, source: "org" };
  return { norms: NORM_CATALOG.filter((doc) => doc.recommended).map((doc) => doc.title), source: "recommended" };
}

/** Утверждения ППК и ХАССП-плана: номер и дата последней версии, без ФИО. */
export function resolveNormApprovals(versions: DocVersion[]): InspectionNorms["approvals"] {
  const pick = (doc: InspectionNormDoc) => {
    const latest = latestDocVersion(versions, doc);
    return latest ? { version: latest.version, approvedAt: latest.approvedAt } : null;
  };
  return { ppk: pick("ppk"), "haccp-plan": pick("haccp-plan") };
}

/** `haccp-plan` (вид документа ППК) → `haccp_plan` (вид `KnowledgeDocument`). */
export function knowledgeKindOf(doc: InspectionNormDoc): "ppk" | "haccp_plan" {
  return doc === "ppk" ? "ppk" : "haccp_plan";
}

export function isInspectionNormDoc(value: unknown): value is InspectionNormDoc {
  return value === "ppk" || value === "haccp-plan";
}
