/**
 * TasksFlow adapter for «Журнал учета аварий» (accident_journal).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new AccidentRow to config.rows[]
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  ACCIDENT_DOCUMENT_TEMPLATE_CODE,
  type AccidentDocumentConfig,
  type AccidentRow,
  normalizeAccidentDocumentConfig,
} from "@/lib/accident-document";
import { toDateKey } from "@/lib/hygiene-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const TEMPLATE_CODE = ACCIDENT_DOCUMENT_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "locationName", label: "Место аварии", required: true, maxLength: 200, placeholder: "Например: склад сырья" },
    { type: "text", key: "accidentDescription", label: "Описание аварии", required: true, multiline: true, maxLength: 400, placeholder: "Что произошло" },
    { type: "text", key: "affectedProducts", label: "Пострадавшая продукция / оборудование", required: false, multiline: true, maxLength: 300, placeholder: "Что повреждено" },
    { type: "text", key: "correctiveActions", label: "Принятые меры", required: true, multiline: true, maxLength: 400, placeholder: "Что сделано для устранения" },
  ];
  return {
    intro: "Оформите запись об аварийном случае.",
    submitLabel: "Сохранить запись",
    fields,
  };
}

export const accidentJournalAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Журнал аварий",
    description: "Регистрация аварийных случаев",
    iconName: "alert-triangle",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Авария · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Оформите запись при аварии."].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees] = await Promise.all([
      db.journalDocument.findMany({
        where: { organizationId, status: "active", template: { code: TEMPLATE_CODE } },
        select: { id: true, title: true, dateFrom: true, dateTo: true },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ]);
    return docs.map<AdapterDocument>((doc) => ({
      documentId: doc.id,
      documentTitle: doc.title,
      period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
      rows: employees.map<AdapterRow>((emp) => ({
        rowKey: rowKeyForEmployee(emp.id),
        label: emp.name,
        sublabel: emp.positionTitle ?? undefined,
        responsibleUserId: emp.id,
      })),
    }));
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm() {
    return buildForm();
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;

    // Сотрудник — до блокировки: запрос в пул из транзакции с блокировкой
    // при пачке отправок ждал бы второго соединения. Организация документа
    // не меняется, это чтение не устаревает.
    const owner = await db.journalDocument.findUnique({ where: { id: documentId }, select: { organizationId: true } });
    const employee = await findTaskEmployee({ employeeId, organizationId: owner?.organizationId });
    if (!employee) return false;

    // Под блокировкой документа: конфиг читается внутри неё, иначе две
    // одновременные отправки (QR, TasksFlow, сайт) теряли одну из записей.
    const written = await withDocumentConfigLock(documentId, async (doc) => {
      if (doc.templateCode !== TEMPLATE_CODE) return null;

      const currentConfig = normalizeAccidentDocumentConfig(doc.config) as AccidentDocumentConfig;

      const now = new Date();
      const newRow: AccidentRow = {
        id: `accident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        accidentDate: todayKey,
        accidentHour: String(now.getHours()).padStart(2, "0"),
        accidentMinute: String(now.getMinutes()).padStart(2, "0"),
        locationName: typeof values?.locationName === "string" ? values.locationName : "",
        accidentDescription: typeof values?.accidentDescription === "string" ? values.accidentDescription : "",
        affectedProducts: typeof values?.affectedProducts === "string" ? values.affectedProducts : "",
        resolvedDate: todayKey,
        resolvedHour: String(now.getHours()).padStart(2, "0"),
        resolvedMinute: String(now.getMinutes()).padStart(2, "0"),
        responsiblePeople: employee?.name ?? "",
        correctiveActions: typeof values?.correctiveActions === "string" ? values.correctiveActions : "",
      };

      const nextConfig: AccidentDocumentConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
      return { config: nextConfig as unknown as Prisma.InputJsonValue, result: true };
    });
    return written === true;
  },
};
