/**
 * TasksFlow adapter for «Карточка истории поломок» (breakdown_history).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new BreakdownRow to config.rows[]
 */
import { db } from "@/lib/db";
import {
  BREAKDOWN_HISTORY_TEMPLATE_CODE,
  type BreakdownHistoryDocumentConfig,
  type BreakdownRow,
  normalizeBreakdownHistoryDocumentConfig,
} from "@/lib/breakdown-history-document";
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

const TEMPLATE_CODE = BREAKDOWN_HISTORY_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "equipmentName", label: "Оборудование", required: true, maxLength: 200, placeholder: "Например: холодильник №3" },
    { type: "text", key: "breakdownDescription", label: "Описание поломки", required: true, multiline: true, maxLength: 400, placeholder: "Что произошло" },
    { type: "text", key: "repairPerformed", label: "Выполненный ремонт", required: true, multiline: true, maxLength: 400, placeholder: "Что сделано" },
    { type: "text", key: "partsReplaced", label: "Замененные запчасти", required: false, maxLength: 200, placeholder: "Например: компрессор" },
    { type: "text", key: "downtimeHours", label: "Время простоя (часов)", required: false, maxLength: 50, placeholder: "1,5" },
  ];
  return {
    intro: "Оформите карточку поломки оборудования.",
    submitLabel: "Сохранить поломку",
    fields,
  };
}

export const breakdownHistoryAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "История поломок",
    description: "Оформление карточки поломки оборудования",
    iconName: "wrench",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Поломка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Оформите карточку при поломке."].join("\n");
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

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true, template: { select: { code: true } } },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE) return false;

    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;
    const currentConfig = normalizeBreakdownHistoryDocumentConfig(doc.config) as BreakdownHistoryDocumentConfig;

    const newRow: BreakdownRow = {
      id: `breakdown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startDate: todayKey,
      startHour: String(new Date().getHours()).padStart(2, "0"),
      startMinute: String(new Date().getMinutes()).padStart(2, "0"),
      // Задача из TF приходит текстом — со справочником не связана.
      sourceEquipmentId: null,
      equipmentName: typeof values?.equipmentName === "string" ? values.equipmentName : "",
      breakdownDescription: typeof values?.breakdownDescription === "string" ? values.breakdownDescription : "",
      repairPerformed: typeof values?.repairPerformed === "string" ? values.repairPerformed : "",
      partsReplaced: typeof values?.partsReplaced === "string" ? values.partsReplaced : "",
      endDate: todayKey,
      endHour: String(new Date().getHours()).padStart(2, "0"),
      endMinute: String(new Date().getMinutes()).padStart(2, "0"),
      downtimeHours: typeof values?.downtimeHours === "string" ? values.downtimeHours : "",
      responsiblePerson: employee?.name ?? "",
    };

    const nextConfig: BreakdownHistoryDocumentConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
