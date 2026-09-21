/**
 * TasksFlow adapter for «Журнал учета дезинфицирующих средств» (disinfectant_usage).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new ReceiptRow to config.receipts[]
 */
import { db } from "@/lib/db";
import {
  DISINFECTANT_TEMPLATE_CODE,
  type DisinfectantDocumentConfig,
  type ReceiptRow,
  createEmptyReceipt,
  MEASURE_UNIT_LABELS,
  type MeasureUnit,
} from "@/lib/disinfectant-document";
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

const TEMPLATE_CODE = DISINFECTANT_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const unitOptions = (Object.entries(MEASURE_UNIT_LABELS) as [MeasureUnit, string][]).map(
    ([value, label]) => ({ value, label })
  );
  const fields: TaskFormField[] = [
    { type: "text", key: "disinfectantName", label: "Наименование дезсредства", required: true, maxLength: 200, placeholder: "Например: Ph средство дезинфицирующее" },
    { type: "text", key: "quantity", label: "Количество", required: true, maxLength: 50, placeholder: "30" },
    { type: "select", key: "unit", label: "Единица измерения", required: true, options: unitOptions, defaultValue: "kg" },
    { type: "date", key: "expiryDate", label: "Срок годности", required: true },
  ];
  return {
    intro: "Зарегистрируйте поступление дезинфицирующего средства.",
    submitLabel: "Сохранить поступление",
    fields,
  };
}

function safeNumberFromString(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export const disinfectantUsageAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Дезинфицирующие средства",
    description: "Учёт поступления дезинфицирующих средств",
    iconName: "spray-can",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Поступление дезсредства · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Зарегистрируйте поступление."].join("\n");
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

    // Документ может быть создан с пустым `config` (auto-create cron
    // или ручное создание без формы). В этом случае спрэд `[...currentConfig.receipts]`
    // падает с «receipts is not iterable». Гарантируем массив.
    const rawConfig = (doc.config ?? {}) as Partial<DisinfectantDocumentConfig>;
    const currentConfig: DisinfectantDocumentConfig = {
      ...rawConfig,
      receipts: Array.isArray(rawConfig.receipts) ? rawConfig.receipts : [],
      responsibleRole: rawConfig.responsibleRole ?? "Сотрудник",
    } as DisinfectantDocumentConfig;

    // Должность исполнителя из справочника (findTaskEmployee), а не
    // ответственного документа: строка принадлежит исполнителю.
    const newRow: ReceiptRow = createEmptyReceipt(
      employee?.positionTitle ?? "",
      employee?.name ?? "",
      employeeId
    );
    newRow.date = todayKey;
    newRow.disinfectantName = typeof values?.disinfectantName === "string" ? values.disinfectantName : "";
    newRow.quantity = safeNumberFromString(values?.quantity);
    newRow.unit = (typeof values?.unit === "string" ? values.unit : "kg") as MeasureUnit;
    newRow.expiryDate = typeof values?.expiryDate === "string" ? values.expiryDate : todayKey;

    const nextConfig: DisinfectantDocumentConfig = { ...currentConfig, receipts: [...currentConfig.receipts, newRow] };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
