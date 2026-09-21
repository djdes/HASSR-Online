/**
 * TasksFlow adapter for «Журнал входного контроля» (incoming_control /
 * incoming_raw_materials_control).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new AcceptanceRow to config.rows[]
 */
import { db } from "@/lib/db";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE,
  type AcceptanceDocumentConfig,
  type AcceptanceRow,
  createAcceptanceRow,
} from "@/lib/acceptance-document";
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

const TEMPLATE_CODES = [ACCEPTANCE_DOCUMENT_TEMPLATE_CODE, RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE];

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "productName", label: "Наименование продукции", required: true, maxLength: 200, placeholder: "Например: мука пшеничная в/с" },
    { type: "text", key: "manufacturer", label: "Изготовитель", required: false, maxLength: 200, placeholder: "ООО \"Агро-Юг\"" },
    { type: "text", key: "supplier", label: "Поставщик", required: false, maxLength: 200, placeholder: "ООО \"Метро\"" },
    { type: "select", key: "transportCondition", label: "Состояние транспорта", required: true, options: [{ value: "satisfactory", label: "Удовлетворительно" }, { value: "unsatisfactory", label: "Неудовлетворительно" }], defaultValue: "satisfactory" },
    { type: "select", key: "packagingCompliance", label: "Соответствие упаковки", required: true, options: [{ value: "compliant", label: "Соответствует" }, { value: "non_compliant", label: "Не соответствует" }], defaultValue: "compliant" },
    { type: "select", key: "organolepticResult", label: "Органолептическая оценка", required: true, options: [{ value: "satisfactory", label: "Удовлетворительно" }, { value: "unsatisfactory", label: "Неудовлетворительно" }], defaultValue: "satisfactory" },
    { type: "text", key: "note", label: "Примечание", required: false, multiline: true, maxLength: 300, placeholder: "Дополнительная информация" },
  ];
  return {
    intro: "Оформите запись входного контроля продукции.",
    submitLabel: "Сохранить приёмку",
    fields,
  };
}

function makeAdapter(templateCode: string, label: string, description: string, iconName: string): JournalAdapter {
  return {
    meta: { templateCode, label, description, iconName },

    scheduleForRow(): TaskSchedule {
      return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
    },

    titleForRow(row): string {
      return `Приёмка · ${row.label}`;
    },

    descriptionForRow(_row, doc): string {
      return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Оформите приёмку поставки."].join("\n");
    },

    async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
      const [docs, employees] = await Promise.all([
        db.journalDocument.findMany({
          where: { organizationId, status: "active", template: { code: templateCode } },
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
      if (!doc || !TEMPLATE_CODES.includes(doc.template.code)) return false;
      const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
      if (!employee) return false;

      // Защита от пустого doc.config — без `?? {}` `currentConfig.rows`
      // падает с «Cannot read properties of null».
      const rawConfig = (doc.config ?? {}) as Partial<AcceptanceDocumentConfig>;
      const currentConfig: AcceptanceDocumentConfig = {
        ...rawConfig,
        rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
      } as AcceptanceDocumentConfig;

      const newRow: AcceptanceRow = createAcceptanceRow({
        deliveryDate: todayKey,
        deliveryHour: String(new Date().getHours()).padStart(2, "0"),
        deliveryMinute: String(new Date().getMinutes()).padStart(2, "0"),
        productName: typeof values?.productName === "string" ? values.productName : "",
        manufacturer: typeof values?.manufacturer === "string" ? values.manufacturer : "",
        supplier: typeof values?.supplier === "string" ? values.supplier : "",
        transportCondition: values?.transportCondition === "unsatisfactory" ? "unsatisfactory" : "satisfactory",
        packagingCompliance: values?.packagingCompliance === "non_compliant" ? "non_compliant" : "compliant",
        organolepticResult: values?.organolepticResult === "unsatisfactory" ? "unsatisfactory" : "satisfactory",
        note: typeof values?.note === "string" ? values.note : "",
        responsibleTitle: employee?.name ?? "",
        responsibleUserId: employeeId,
      });

      const nextConfig: AcceptanceDocumentConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
      await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
      return true;
    },
  };
}

export const acceptanceAdapter = makeAdapter(
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  "Входной контроль продукции",
  "Приёмка и входной контроль продукции",
  "package-check"
);

export const rawMaterialAcceptanceAdapter = makeAdapter(
  RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE,
  "Входной контроль сырья",
  "Приёмка сырья, ингредиентов, упаковки",
  "package-check"
);
