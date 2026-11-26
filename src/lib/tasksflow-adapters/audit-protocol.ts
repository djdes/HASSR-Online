/**
 * TasksFlow adapter for «Протокол внутреннего аудита» (audit_protocol).
 *
 * Mapping:
 *   • adapter row  = protocol item (rowKey = protocol-<rowId>)
 *   • completion   = set result and note
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  type AuditProtocolConfig,
  type AuditProtocolRow,
} from "@/lib/audit-protocol-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";

const TEMPLATE_CODE = AUDIT_PROTOCOL_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "select", key: "result", label: "Результат", required: true, options: [{ value: "yes", label: "Соответствует" }, { value: "no", label: "Не соответствует" }, { value: "", label: "—" }], defaultValue: "" },
    { type: "text", key: "note", label: "Примечание", required: false, multiline: true, maxLength: 300, placeholder: "Замечания по пункту" },
  ];
  return {
    intro: "Заполните результат проверки пункта протокола аудита.",
    submitLabel: "Сохранить",
    fields,
  };
}

export const auditProtocolAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Протокол аудита",
    description: "Протокол внутреннего аудита",
    iconName: "file-check",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Проверка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Заполните результат проверки."].join("\n");
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
      const config = doc.config as AuditProtocolConfig;
      const cfgResp = (config as unknown as { responsibleEmployeeId?: string | null })
        ?.responsibleEmployeeId;
      const docResp = cfgResp ?? doc.responsibleUserId ?? null;
      const rows: AdapterRow[] = (config?.rows ?? []).map<AdapterRow>((row) => ({
        rowKey: `protocol-${row.id}`,
        label: row.text || "Пункт протокола",
        sublabel: row.result === "yes" ? "Соответствует" : row.result === "no" ? "Не соответствует" : "—",
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
    // Выполнение без значений формы (pull-синхронизация, вебхук TasksFlow,
    // подтверждение задачи с `values: {}`) — записывать нечего: раньше оно
    // сбрасывало поля строки в пустые.
    if (!completed || !values || Object.keys(values).length === 0) return false;
    const rowId = rowKey.startsWith("protocol-") ? rowKey.slice(9) : undefined;
    if (!rowId) return false;

    // Под блокировкой документа: конфиг читается внутри неё, иначе две
    // одновременные отправки (QR, TasksFlow, сайт) теряли одну из записей.
    const written = await withDocumentConfigLock(documentId, async (doc) => {
      if (doc.templateCode !== TEMPLATE_CODE) return null;

      // Защита от пустого doc.config — `as` не проверяет рантайм, и без
      // `?? {}` `.rows.map` падает с «Cannot read properties of null».
      const rawConfig = (doc.config ?? {}) as Partial<AuditProtocolConfig>;
      const currentConfig: AuditProtocolConfig = {
        ...rawConfig,
        rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
        sections: Array.isArray(rawConfig.sections) ? rawConfig.sections : [],
        signatures: Array.isArray(rawConfig.signatures) ? rawConfig.signatures : [],
      } as AuditProtocolConfig;
      const nextRows = currentConfig.rows.map((row: AuditProtocolRow) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          result: ((values?.result === "yes" || values?.result === "no") ? values.result : "") as "" | "yes" | "no",
          note: typeof values?.note === "string" ? values.note : row.note,
        };
      });

      const nextConfig: AuditProtocolConfig = { ...currentConfig, rows: nextRows };
      return { config: nextConfig as unknown as Prisma.InputJsonValue, result: true };
    });
    return written === true;
  },
};
