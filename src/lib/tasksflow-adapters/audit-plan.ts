/**
 * TasksFlow adapter for «План-программа внутренних аудитов» (audit_plan).
 *
 * Mapping:
 *   • adapter row  = audit item (rowKey = audit-<rowId>)
 *   • completion   = check the item and fill auditor comment
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  AUDIT_PLAN_TEMPLATE_CODE,
  type AuditPlanConfig,
  type AuditPlanRow,
} from "@/lib/audit-plan-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";

const TEMPLATE_CODE = AUDIT_PLAN_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "boolean", key: "checked", label: "Проверено" },
    { type: "text", key: "comment", label: "Комментарий аудитора", required: false, multiline: true, maxLength: 300, placeholder: "Результаты проверки" },
  ];
  return {
    intro: "Отметьте выполнение пункта плана-программы аудита.",
    submitLabel: "Сохранить",
    fields,
  };
}

export const auditPlanAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "План-программа аудитов",
    description: "План-программа внутренних аудитов",
    iconName: "clipboard-list",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Аудит · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Отметьте проверку пункта."].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const docs = await db.journalDocument.findMany({
      where: { organizationId, status: "active", template: { code: TEMPLATE_CODE } },
      select: {
        id: true,
        title: true,
        dateFrom: true,
        dateTo: true,
        config: true,
        responsibleUserId: true,
      },
      orderBy: { dateFrom: "desc" },
    });
    return docs.map<AdapterDocument>((doc) => {
      const config = doc.config as AuditPlanConfig;
      // bulk-assign-today фильтрует rows по `responsibleUserId` — null
      // означает «отвечать некому», и весь журнал помечается skipped.
      // Берём владельца на уровне документа (config.responsibleEmployeeId
      // или doc.responsibleUserId), чтобы каждая строка была eligible.
      const cfgResp = (config as unknown as { responsibleEmployeeId?: string | null })
        ?.responsibleEmployeeId;
      const docResp = cfgResp ?? doc.responsibleUserId ?? null;
      const rows: AdapterRow[] = (config?.rows ?? []).map<AdapterRow>((row) => ({
        rowKey: `audit-${row.id}`,
        label: row.text || "Пункт аудита",
        sublabel: row.checked ? "✓ Проверено" : "Не проверено",
        responsibleUserId: docResp,
      }));
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: rows.length > 0 ? rows : [{ rowKey: "default", label: "Общая запись", responsibleUserId: docResp }],
      };
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm() {
    return buildForm();
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, values }) {
    // Выполнение без значений формы (pull-синхронизация, вебхук TasksFlow) —
    // записывать нечего: раньше оно сбрасывало поля строки в пустые.
    if (!completed || !values) return false;
    const rowId = rowKey.startsWith("audit-") ? rowKey.slice(6) : undefined;
    if (!rowId) return false;

    // Под блокировкой документа: конфиг читается внутри неё, иначе две
    // одновременные отправки (QR, TasksFlow, сайт) теряли одну из записей.
    const written = await withDocumentConfigLock(documentId, async (doc) => {
      if (doc.templateCode !== TEMPLATE_CODE) return null;

      // Защита от пустого doc.config — `as` не проверяет рантайм, и без
      // `?? {}` `.rows.map` / `.columns[0]` падают с null.
      const rawConfig = (doc.config ?? {}) as Partial<AuditPlanConfig>;
      const currentConfig: AuditPlanConfig = {
        ...rawConfig,
        rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
        columns: Array.isArray(rawConfig.columns) ? rawConfig.columns : [],
      } as AuditPlanConfig;
      const nextRows = currentConfig.rows.map((row: AuditPlanRow) => {
        if (row.id !== rowId) return row;
        const comment = typeof values?.comment === "string" ? values.comment : "";
        const auditorColumnId = currentConfig.columns[0]?.id ?? "auditor";
        return {
          ...row,
          checked: values?.checked === true || values?.checked === "true",
          values: { ...row.values, [auditorColumnId]: comment },
        };
      });

      const nextConfig: AuditPlanConfig = { ...currentConfig, rows: nextRows };
      return { config: nextConfig as unknown as Prisma.InputJsonValue, result: true };
    });
    return written === true;
  },
};
