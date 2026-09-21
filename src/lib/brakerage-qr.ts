import type { Prisma } from "@prisma/client";

import { normalizeRowSignatures, type BrakerageRowSignature } from "@/lib/brakerage-commission";
import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  createFinishedProductRow,
  getFinishedProductOrganolepticOptions,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import { visibleColumns } from "@/lib/journal-columns";
import {
  createPerishableRejectionRow,
  normalizePerishableRejectionConfig,
} from "@/lib/perishable-rejection-document";

/**
 * Список бракеража «за сегодня» для QR (п. 10 ТЗ): строки сегодняшнего дня
 * плюс неподписанные вчерашние (ужин комиссия подписывает утром), в том
 * числе из вчерашнего документа, если он ещё не закрыт (переход месяца).
 */

export type BrakerageQrRow = {
  documentId: string;
  rowId: string;
  name: string;
  /** «ЧЧ:ММ» изготовления (готовая продукция) или поступления (скоропорт). */
  time: string;
  dayKey: string;
  fromYesterday: boolean;
  /** Готовая продукция — текст оценки; скоропорт — код. */
  grade: string;
  releaseAllowed: "yes" | "no" | null;
  portionWeight: string;
  note: string;
  signatures: BrakerageRowSignature[];
};

export type BrakerageQrList = {
  rows: BrakerageQrRow[];
  gradeOptions: Array<{ value: string; label: string }>;
  /** Колонка «Результат взвешивания» видна — спрашиваем вес. */
  showPortion: boolean;
};

export const PERISHABLE_GRADE_LABELS: Record<string, string> = {
  compliant: "Соответствует",
  good_quality: "Доброкачественная",
  non_compliant: "Не соответствует",
  poor_quality: "Недоброкачественная",
};

function timeOf(raw: unknown): string {
  const match = typeof raw === "string" ? /(\d{1,2}):(\d{2})/.exec(raw) : null;
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

export async function listBrakerageDayRows(params: {
  organizationId: string;
  code: string;
  todayKey: string;
  yesterdayKey: string;
  /** Документ, выбранный на QR, — его настройки (оценки, колонки) главные. */
  primaryDocumentId: string;
}): Promise<BrakerageQrList> {
  const yesterday = new Date(`${params.yesterdayKey}T00:00:00.000Z`);
  const today = new Date(`${params.todayKey}T00:00:00.000Z`);
  const found = await db.journalDocument.findMany({
    where: {
      organizationId: params.organizationId,
      status: "active",
      template: { code: params.code },
      dateFrom: { lte: today },
      dateTo: { gte: yesterday },
    },
    select: { id: true, config: true, dateTo: true },
    orderBy: { dateFrom: "desc" },
  });
  // Выбранный документ и вчерашний, ещё не закрытый (кончился вчера — переход
  // месяца). Документы других точек с тем же журналом сюда не попадают.
  const docs = found.filter((doc) => doc.id === params.primaryDocumentId || doc.dateTo < today);
  const primary = docs.find((doc) => doc.id === params.primaryDocumentId) ?? docs[0];
  const rows: BrakerageQrRow[] = [];
  const pick = (dayKey: string, signatures: BrakerageRowSignature[]) =>
    dayKey === params.todayKey || (dayKey === params.yesterdayKey && signatures.length === 0);

  for (const doc of docs) {
    if (params.code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
      const config = normalizeFinishedProductDocumentConfig(doc.config);
      for (const row of config.rows) {
        const dayKey = row.productionDateTime.slice(0, 10);
        const signatures = normalizeRowSignatures(row.signatures);
        if (!row.productName.trim() || !pick(dayKey, signatures)) continue;
        rows.push({
          documentId: doc.id,
          rowId: row.id,
          name: row.productName,
          time: timeOf(row.productionDateTime),
          dayKey,
          fromYesterday: dayKey !== params.todayKey,
          grade: row.organoleptic,
          releaseAllowed: row.releaseAllowed === "no" ? "no" : "yes",
          portionWeight: row.portionWeight ?? "",
          note: row.note ?? "",
          signatures,
        });
      }
    } else {
      const config = normalizePerishableRejectionConfig(doc.config);
      for (const row of config.rows) {
        const dayKey = row.arrivalDate.slice(0, 10);
        const signatures = normalizeRowSignatures(row.signatures);
        if (!row.productName.trim() || !pick(dayKey, signatures)) continue;
        rows.push({
          documentId: doc.id,
          rowId: row.id,
          name: row.productName,
          time: timeOf(row.arrivalTime),
          dayKey,
          fromYesterday: dayKey !== params.todayKey,
          grade: row.organolepticResult,
          releaseAllowed: null,
          portionWeight: "",
          note: row.note ?? "",
          signatures,
        });
      }
    }
  }
  // Неподписанные сверху, внутри — по дню и времени.
  rows.sort(
    (a, b) =>
      Number(a.signatures.length > 0) - Number(b.signatures.length > 0) ||
      a.dayKey.localeCompare(b.dayKey) ||
      a.time.localeCompare(b.time)
  );

  if (params.code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
    const config = normalizeFinishedProductDocumentConfig(primary?.config ?? {});
    const options = getFinishedProductOrganolepticOptions(config);
    return {
      rows,
      gradeOptions: options.map((value) => ({ value, label: value })),
      showPortion: visibleColumns(params.code, config).some((column) => column.key === "portion"),
    };
  }
  return {
    rows,
    gradeOptions: ["compliant", "good_quality", "non_compliant", "poor_quality"].map((value) => ({ value, label: PERISHABLE_GRADE_LABELS[value] ?? value })),
    showPortion: false,
  };
}

export type BrakerageRowEdit = { rowId: string; name?: string; time?: string };

/**
 * Правка списка по QR тем, кто уполномочен (п. 10): наименование, время,
 * удаление строки. Подпись под изменённой строкой остаётся и получает
 * пометку «изменено после подписи» (снимок в подписи).
 */
export async function editBrakerageRows(params: {
  documentId: string;
  organizationId: string;
  edits: BrakerageRowEdit[];
  deleteRowIds?: string[];
}): Promise<{ ok: true; changed: number; deleted: number } | { ok: false; error: string }> {
  const byId = new Map(params.edits.map((edit) => [edit.rowId, edit]));
  const toDelete = new Set(params.deleteRowIds ?? []);
  type EditResult = { ok: true; changed: number; deleted: number } | { ok: false; error: string };
  const result = await withDocumentConfigLock<EditResult>(params.documentId, async (doc) => {
    if (doc.organizationId !== params.organizationId) return { result: { ok: false as const, error: "Документ не найден" } };
    if (doc.status !== "active") return { result: { ok: false as const, error: "Журнал закрыт — править нельзя" } };
    let changed = 0;
    let deleted = 0;
    const cleanName = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const cleanTime = (value: string | undefined) => timeOf(value ?? "");

    if (doc.templateCode === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
      const config = normalizeFinishedProductDocumentConfig(doc.config);
      const rows = [];
      for (const row of config.rows) {
        if (toDelete.has(row.id)) {
          deleted += 1;
          continue;
        }
        const edit = byId.get(row.id);
        const name = cleanName(edit?.name);
        const time = cleanTime(edit?.time);
        const nextName = name || row.productName;
        const nextDateTime = time ? `${row.productionDateTime.slice(0, 10)} ${time}`.trim() : row.productionDateTime;
        if (edit && (nextName !== row.productName || nextDateTime !== row.productionDateTime)) {
          rows.push(createFinishedProductRow({ ...row, productName: nextName, productionDateTime: nextDateTime }));
          changed += 1;
        } else rows.push(row);
      }
      if (changed === 0 && deleted === 0) return { result: { ok: true as const, changed, deleted } };
      return { config: { ...config, rows } as unknown as Prisma.InputJsonValue, result: { ok: true as const, changed, deleted } };
    }

    const config = normalizePerishableRejectionConfig(doc.config);
    const rows = [];
    for (const row of config.rows) {
      if (toDelete.has(row.id)) {
        deleted += 1;
        continue;
      }
      const edit = byId.get(row.id);
      const nextName = cleanName(edit?.name) || row.productName;
      const nextTime = cleanTime(edit?.time) || row.arrivalTime;
      if (edit && (nextName !== row.productName || nextTime !== row.arrivalTime)) {
        rows.push(createPerishableRejectionRow({ ...row, productName: nextName, arrivalTime: nextTime }));
        changed += 1;
      } else rows.push(row);
    }
    if (changed === 0 && deleted === 0) return { result: { ok: true as const, changed, deleted } };
    return { config: { ...config, rows } as unknown as Prisma.InputJsonValue, result: { ok: true as const, changed, deleted } };
  });
  return result ?? { ok: false, error: "Документ не найден" };
}
