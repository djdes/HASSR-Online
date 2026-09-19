/**
 * TasksFlow adapter for «Бракераж скоропортящейся пищевой продукции»
 * (perishable_rejection).
 *
 * Stores rows inside `JournalDocument.config.rows[]` like
 * finished_product. Each worker completion = one event (a delivery
 * that was accepted or rejected).
 *
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = upsert row into config.rows[] by sourceRowKey,
 *                    so re-completing the same TF task updates its
 *                    row instead of duplicating.
 *   • form         = productName + supplier + quantity +
 *                    organoleptic result (да/нет брак) + note.
 *
 * Today-compliance recognises this journal as filled when at least one
 * row carries today's date (`arrivalDate.slice(0,10) === todayKey`).
 */
import { db } from "@/lib/db";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  type PerishableRejectionConfig,
  type PerishableRejectionRow,
} from "@/lib/perishable-rejection-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormSchema } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";

const TEMPLATE_CODE = PERISHABLE_REJECTION_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function normalizeTime(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const m = /^(\d{1,2})[:.]?(\d{0,2})$/.exec(raw.trim());
  if (!m) return "";
  const hh = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const mm = Math.min(59, Math.max(0, Number(m[2] || 0) || 0));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function buildPerishableForm(employeeName: string | null): TaskFormSchema {
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "зафиксируйте приёмку партии скоропортящейся продукции.",
    submitLabel: "Сохранить приёмку",
    fields: [
      {
        type: "text",
        key: "productName",
        label: "Наименование продукта",
        required: true,
        placeholder: "Например: молоко 3,2%",
        maxLength: 200,
      },
      {
        type: "text",
        key: "supplier",
        label: "Поставщик",
        required: true,
        placeholder: "Например: ООО Молочник",
        maxLength: 200,
      },
      {
        type: "text",
        key: "quantity",
        label: "Количество / масса",
        required: true,
        placeholder: "Например: 20 кг",
        maxLength: 80,
      },
      {
        type: "time",
        key: "arrivalTime",
        label: "Время приёмки",
        placeholder: "09:30",
      },
      {
        type: "select",
        key: "organolepticResult",
        label: "Органолептика",
        required: true,
        options: [
          { value: "compliant", label: "Соответствует — принято" },
          { value: "non_compliant", label: "Не соответствует — брак" },
        ],
        defaultValue: "compliant",
      },
      {
        type: "text",
        key: "note",
        label: "Примечание",
        multiline: true,
        maxLength: 300,
        placeholder: "Например: упаковка целая, сроки годные",
      },
    ],
  };
}

export const perishableRejectionAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Бракераж скоропортящихся",
    description:
      "Приёмка скоропортящейся продукции — продукт, поставщик, результат.",
    iconName: "package",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Приёмка скоропорта · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "После приёмки заполните форму из задачи.",
    ].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees] = await Promise.all([
      db.journalDocument.findMany({
        where: {
          organizationId,
          status: "active",
          template: { code: TEMPLATE_CODE },
        },
        select: { id: true, title: true, dateFrom: true, dateTo: true },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true },
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

  async getTaskForm({ documentId, rowKey }) {
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return buildPerishableForm(null);
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true },
    });
    const emp = await findTaskEmployee({
      employeeId,
      organizationId: doc?.organizationId,
    });
    return buildPerishableForm(emp?.name ?? null);
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
    const currentConfig = (doc.config ?? {}) as PerishableRejectionConfig;
    const existingRows = Array.isArray(currentConfig.rows)
      ? currentConfig.rows
      : [];

    // Upsert-by-sourceRowKey: re-completion of the same TF task updates
    // the existing row instead of appending a duplicate. Manual admin
    // rows (no sourceRowKey) are untouched.
    const existingIndex = existingRows.findIndex(
      (r) => r.sourceRowKey === rowKey
    );
    const existingId =
      existingIndex >= 0
        ? existingRows[existingIndex].id
        : `perishable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const organolepticResult =
      values?.organolepticResult === "non_compliant"
        ? "non_compliant"
        : "compliant";

    const row: PerishableRejectionRow = {
      id: existingId,
      arrivalDate: todayKey,
      arrivalTime: normalizeTime(values?.arrivalTime),
      productName:
        typeof values?.productName === "string" ? values.productName : "",
      productionDate: "",
      manufacturer: "",
      supplier:
        typeof values?.supplier === "string" ? values.supplier : "",
      packaging: "",
      quantity:
        typeof values?.quantity === "string" ? values.quantity : "",
      documentNumber: "",
      organolepticResult,
      storageCondition: "2_6",
      expiryDate: "",
      expiryTime: "",
      actualSaleDate: "",
      actualSaleTime: "",
      responsiblePerson: employee?.name ?? "",
      note: typeof values?.note === "string" ? values.note : "",
      sourceRowKey: rowKey,
    };

    const nextRows =
      existingIndex >= 0
        ? existingRows.map((r, i) => (i === existingIndex ? row : r))
        : [...existingRows, row];
    const nextConfig: PerishableRejectionConfig = {
      ...currentConfig,
      rows: nextRows,
    };

    await db.journalDocument.update({
      where: { id: documentId },
      data: { config: nextConfig },
    });
    return true;
  },
};
