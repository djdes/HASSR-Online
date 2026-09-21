/**
 * TasksFlow adapter for «Акт забраковки» (product_writeoff).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new ProductWriteoffRow to config.rows[]
 *   • form         = product + batch + quantity + discrepancy + action
 */
import { db } from "@/lib/db";
import {
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  type ProductWriteoffConfig,
  type ProductWriteoffRow,
  normalizeProductWriteoffConfig,
} from "@/lib/product-writeoff-document";
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

const TEMPLATE_CODE = PRODUCT_WRITEOFF_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    {
      type: "text",
      key: "productName",
      label: "Наименование продукции",
      required: true,
      maxLength: 200,
      placeholder: "Например: котлеты куриные",
    },
    {
      type: "text",
      key: "batchNumber",
      label: "Номер партии",
      required: false,
      maxLength: 100,
      placeholder: "Партия / серия",
    },
    {
      type: "text",
      key: "quantity",
      label: "Количество",
      required: true,
      maxLength: 100,
      placeholder: "Например: 5 кг",
    },
    {
      type: "text",
      key: "discrepancyDescription",
      label: "Описание несоответствия",
      required: true,
      multiline: true,
      maxLength: 400,
      placeholder: "Опишите выявленный дефект",
    },
    {
      type: "text",
      key: "action",
      label: "Принятое решение",
      required: true,
      maxLength: 200,
      placeholder: "Например: Утилизация",
    },
  ];
  return {
    intro: "Заполните акт забраковки продукции.",
    submitLabel: "Сохранить в акт",
    fields,
  };
}

export const productWriteoffAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Акт забраковки",
    description: "Оформление акта забраковки продукции",
    iconName: "file-x",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Забраковка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Оформите акт при обнаружении брака.",
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
    const currentConfig = normalizeProductWriteoffConfig(doc.config) as ProductWriteoffConfig;

    const newRow: ProductWriteoffRow = {
      id: `writeoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productName: typeof values?.productName === "string" ? values.productName : "",
      batchNumber: typeof values?.batchNumber === "string" ? values.batchNumber : "",
      productionDate: todayKey,
      quantity: typeof values?.quantity === "string" ? values.quantity : "",
      discrepancyDescription:
        typeof values?.discrepancyDescription === "string"
          ? values.discrepancyDescription
          : "",
      action: typeof values?.action === "string" ? values.action : "",
    };

    const nextConfig: ProductWriteoffConfig = {
      ...currentConfig,
      rows: [...currentConfig.rows, newRow],
    };
    await db.journalDocument.update({
      where: { id: documentId },
      data: { config: nextConfig },
    });
    return true;
  },
};
