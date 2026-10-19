import { db } from "@/lib/db";
import {
  resolveNormApprovals,
  resolveNormTitles,
  type InspectionNorms,
} from "@/lib/inspection-norms";
import { PPK_RECORD_SCHEMAS, type DocVersion, type NormsData } from "@/lib/ppk/records";

/**
 * Данные «Нормативки» одним запросом на блок: метаданные загруженных ППК и
 * ХАССП-плана (без содержимого), отметки норм и версии документов. Битые
 * записи пропускаются.
 */
export async function loadInspectionNorms(organizationId: string): Promise<InspectionNorms> {
  const [docs, rows] = await Promise.all([
    db.knowledgeDocument.findMany({
      where: { organizationId, kind: { in: ["ppk", "haccp_plan"] } },
      select: { kind: true, fileName: true, updatedAt: true },
    }),
    db.ppkRecord.findMany({
      where: { organizationId, block: { in: ["norms", "doc-versions"] } },
      select: { block: true, data: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const valid = <T,>(block: "norms" | "doc-versions"): T[] =>
    rows.flatMap((row) => {
      if (row.block !== block) return [];
      const parsed = PPK_RECORD_SCHEMAS[block].safeParse(row.data);
      return parsed.success ? [parsed.data as T] : [];
    });
  const file = (kind: "ppk" | "haccp_plan") => {
    const doc = docs.find((item) => item.kind === kind);
    return doc ? { fileName: doc.fileName, updatedAt: doc.updatedAt.toISOString() } : null;
  };
  const titles = resolveNormTitles(valid<NormsData>("norms")[0] ?? null);
  return {
    uploaded: { ppk: file("ppk"), "haccp-plan": file("haccp_plan") },
    approvals: resolveNormApprovals(valid<DocVersion>("doc-versions")),
    norms: titles.norms,
    normsSource: titles.source,
  };
}
