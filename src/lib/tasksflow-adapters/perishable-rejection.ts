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
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  createPerishableRejectionRow,
  formatPerishableResponsible,
  normalizePerishableOrganoleptic,
  normalizePerishableRejectionConfig,
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
          { value: "good_quality", label: "Доброкачественная — принято" },
          { value: "non_compliant", label: "Не соответствует — брак" },
          { value: "poor_quality", label: "Недоброкачественная — брак" },
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
    // Сотрудник из rowKey (внешний сервис) — только своей организации.
    const doc = await db.journalDocument.findUnique({ where: { id: documentId }, select: { organizationId: true } });
    const employee = await findTaskEmployee({ employeeId, organizationId: doc?.organizationId });
    if (!employee) return false;
    const written = await appendPerishableRows({
      documentId,
      employee,
      todayKey,
      entries: [{ rowKey, values: values ?? {} }],
    });
    return written > 0;
  },
};

function textValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : undefined;
}

/**
 * Записать строки скоропорта (QR, TasksFlow, «Несколько позиций» по QR) под
 * блокировкой документа. Повтор той же задачи обновляет свою строку, не
 * трогая поля, заполненные на сайте. Возвращает число записанных строк.
 */
export async function appendPerishableRows(params: {
  documentId: string;
  /** Уже сверенный с организацией документа сотрудник (findTaskEmployee). */
  employee: { id: string; name: string; positionTitle: string | null };
  todayKey: string;
  entries: Array<{ rowKey: string; values: Record<string, unknown> }>;
}): Promise<number> {
  const result = await withDocumentConfigLock(params.documentId, async (doc) => {
    if (doc.templateCode !== TEMPLATE_CODE) return null;
    const employee = params.employee;
    const config = normalizePerishableRejectionConfig(doc.config);
    const rows = [...config.rows];
    let written = 0;
    for (const entry of params.entries) {
      const values = entry.values;
      const patch: Partial<PerishableRejectionRow> = {
        arrivalDate: params.todayKey,
        arrivalTime: normalizeTime(values.arrivalTime),
        productName: textValue(values.productName) ?? "",
        supplier: textValue(values.supplier) ?? "",
        quantity: textValue(values.quantity) ?? "",
        organolepticResult: normalizePerishableOrganoleptic(values.organolepticResult),
        note: textValue(values.note) ?? "",
      };
      const existingIndex = rows.findIndex((row) => row.sourceRowKey === entry.rowKey);
      if (existingIndex >= 0) {
        rows[existingIndex] = createPerishableRejectionRow({ ...rows[existingIndex], ...patch });
      } else {
        rows.push(
          createPerishableRejectionRow({
            ...patch,
            id: `perishable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            storageCondition: "2_6",
            responsiblePerson: formatPerishableResponsible(employee),
            sourceRowKey: entry.rowKey,
          })
        );
      }
      written += 1;
    }
    return { config: { ...config, rows } as unknown as Prisma.InputJsonValue, result: written };
  });
  return result ?? 0;
}
