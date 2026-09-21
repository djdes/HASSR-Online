/**
 * TasksFlow adapter for «Журнал учета металлопримесей в сырье»
 * (metal_impurity).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new MetalImpurityRow to config.rows[]
 */
import { db } from "@/lib/db";
import {
  METAL_IMPURITY_TEMPLATE_CODE,
  type MetalImpurityDocumentConfig,
  type MetalImpurityRow,
  createMetalImpurityRow,
} from "@/lib/metal-impurity-document";
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

const TEMPLATE_CODE = METAL_IMPURITY_TEMPLATE_CODE;

function buildForm(config: MetalImpurityDocumentConfig): TaskFormSchema {
  // Защита от старых документов где config может быть неполным —
  // без `?? []` адаптер падает и журналс-catalog ломается целиком
  // (см. прод-ошибку «Cannot read properties of undefined»).
  const materialOptions = (config.materials ?? []).map((m) => ({
    value: m.id,
    label: m.name,
  }));
  const supplierOptions = (config.suppliers ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const fields: TaskFormField[] = [
    { type: "select", key: "materialId", label: "Сырьё", required: true, options: materialOptions.length > 0 ? materialOptions : [{ value: "", label: "Не выбрано" }] },
    { type: "select", key: "supplierId", label: "Поставщик", required: true, options: supplierOptions.length > 0 ? supplierOptions : [{ value: "", label: "Не выбрано" }] },
    { type: "text", key: "consumedQuantityKg", label: "Количество использованного сырья (кг)", required: true, maxLength: 50, placeholder: "100" },
    { type: "text", key: "impurityQuantityG", label: "Количество металлопримесей (г)", required: true, maxLength: 50, placeholder: "0" },
    { type: "text", key: "impurityCharacteristic", label: "Характеристика примесей", required: false, maxLength: 200, placeholder: "Например: стружка, скобы" },
  ];
  return {
    intro: "Заполните журнал учёта металлопримесей.",
    submitLabel: "Сохранить запись",
    fields,
  };
}

export const metalImpurityAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Металлопримеси",
    description: "Учёт металлопримесей в сырье",
    iconName: "magnet",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Металлопримеси · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Заполните запись по металлопримесям."].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees] = await Promise.all([
      db.journalDocument.findMany({
        where: { organizationId, status: "active", template: { code: TEMPLATE_CODE } },
        select: { id: true, title: true, dateFrom: true, dateTo: true, config: true },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ]);
    return docs.map<AdapterDocument>((doc) => {
      const config = doc.config as MetalImpurityDocumentConfig;
      const adapterDoc: AdapterDocument = {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: employees.map<AdapterRow>((emp) => ({
          rowKey: rowKeyForEmployee(emp.id),
          label: emp.name,
          sublabel: emp.positionTitle ?? undefined,
          responsibleUserId: emp.id,
        })),
      };
      return adapterDoc;
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm({ documentId }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true },
    });
    if (!doc) return null;
    // Защита от пустого doc.config — buildForm читает .materials/.suppliers,
    // и без `?? {}` падает с «Cannot read properties of null».
    const rawConfig = (doc.config ?? {}) as Partial<MetalImpurityDocumentConfig>;
    const config: MetalImpurityDocumentConfig = {
      ...rawConfig,
      materials: Array.isArray(rawConfig.materials) ? rawConfig.materials : [],
      suppliers: Array.isArray(rawConfig.suppliers) ? rawConfig.suppliers : [],
      rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
      responsiblePosition: rawConfig.responsiblePosition ?? "Сотрудник",
    } as MetalImpurityDocumentConfig;
    return buildForm(config);
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

    // Защита от пустого doc.config — при auto-create rows/materials/suppliers
    // отсутствуют, и .find() / spread падают.
    const rawConfig = (doc.config ?? {}) as Partial<MetalImpurityDocumentConfig>;
    const currentConfig: MetalImpurityDocumentConfig = {
      ...rawConfig,
      materials: Array.isArray(rawConfig.materials) ? rawConfig.materials : [],
      suppliers: Array.isArray(rawConfig.suppliers) ? rawConfig.suppliers : [],
      rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
      responsiblePosition:
        rawConfig.responsiblePosition ?? "Сотрудник",
    } as MetalImpurityDocumentConfig;

    const material = currentConfig.materials.find((m) => m.id === (values?.materialId as string));
    const supplier = currentConfig.suppliers.find((s) => s.id === (values?.supplierId as string));

    const newRow: MetalImpurityRow = createMetalImpurityRow({
      date: todayKey,
      materialId: typeof values?.materialId === "string" ? values.materialId : "",
      supplierId: typeof values?.supplierId === "string" ? values.supplierId : "",
      consumedQuantityKg: typeof values?.consumedQuantityKg === "string" ? values.consumedQuantityKg : "",
      impurityQuantityG: typeof values?.impurityQuantityG === "string" ? values.impurityQuantityG : "",
      impurityCharacteristic: typeof values?.impurityCharacteristic === "string" ? values.impurityCharacteristic : "",
      // Должность исполнителя из справочника, не ответственного документа.
      responsibleRole: employee?.positionTitle ?? "",
      responsibleEmployeeId: employeeId,
      responsibleName: employee?.name ?? "",
    });

    const nextConfig: MetalImpurityDocumentConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
