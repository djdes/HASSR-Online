/**
 * TasksFlow adapter for «Бракеражный журнал готовой пищевой продукции»
 * (finished_product).
 *
 * Хранит строки в config.rows[]. Каждый бракераж блюда — новая
 * FinishedProductDocumentRow.
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = append new row to config.rows[]
 *   • form         = блюдо + дата/время производства + органолептика
 *                    (text) + температура (number, если включено) +
 *                    результат (select yes/no) + коментарий.
 */
import type { Prisma } from "@prisma/client";

import { hasCommission } from "@/lib/brakerage-commission";
import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  createFinishedProductRow,
  getFinishedProductOrganolepticOptions,
  type FinishedProductDocumentConfig,
  type FinishedProductDocumentRow,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
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

const TEMPLATE_CODE = FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function buildForm(
  config: FinishedProductDocumentConfig,
  employeeName: string | null
): TaskFormSchema {
  const fields: TaskFormField[] = [
    {
      type: "text",
      key: "productName",
      label:
        config.fieldNameMode === "semi"
          ? "Наименование полуфабриката"
          : "Наименование блюда",
      required: true,
      maxLength: 200,
      placeholder: "Например: куриный суп",
    },
    {
      type: "time",
      key: "productionTime",
      label: "Время производства",
      required: true,
      placeholder: "14:00",
    },
  ];
  // Оценка: варианты документа (у полуфабрикатов свои).
  const organolepticOptions = getFinishedProductOrganolepticOptions(config);
  if (organolepticOptions.length > 0) {
    fields.push({
      type: "select",
      key: "organoleptic",
      label: "Органолептическая оценка",
      required: true,
      options: organolepticOptions.map((value) => ({ value, label: value })),
      defaultValue: organolepticOptions[0],
    });
  } else {
    fields.push({
      type: "text",
      key: "organoleptic",
      label: "Органолептическая оценка",
      required: true,
      placeholder: "Например: цвет, запах, вкус — без отклонений",
      multiline: true,
      maxLength: 400,
    });
  }
  if (config.showProductTemp) {
    fields.push({
      type: "number",
      key: "productTemp",
      label: "Температура",
      unit: "°C",
      min: -20,
      max: 120,
      step: 0.5,
      required: true,
    });
  }
  fields.push({
    type: "select",
    key: "releaseAllowed",
    label: "Разрешить к выпуску?",
    required: true,
    options: [
      { value: "yes", label: "Да, соответствует" },
      { value: "no", label: "Нет, брак" },
    ],
    defaultValue: "yes",
  });
  if (config.showCorrectiveAction) {
    fields.push({
      type: "text",
      key: "correctiveAction",
      label: "Корректирующее действие (если брак)",
      multiline: true,
      maxLength: 400,
    });
  }
  // Состав бракеражной комиссии задан — подписывающий выбирается из него.
  if (config.commissionMembers.length > 0) {
    fields.push({
      type: "select",
      key: "inspectorName",
      label: "Бракераж провёл",
      required: true,
      options: config.commissionMembers.map((member) => ({
        value: member.employeeName,
        label: member.role ? `${member.employeeName} — ${member.role}` : member.employeeName,
      })),
      defaultValue: config.commissionMembers[0].employeeName,
    });
  }
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "запишите бракераж блюда — органолептическую оценку и решение.",
    submitLabel: "Сохранить бракераж",
    fields,
  };
}

export const finishedProductAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Бракеражный журнал",
    description:
      "Бракераж готовой продукции — органолептическая оценка, решение о выпуске.",
    iconName: "chef-hat",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Бракераж · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "После выпуска блюда заполните оценку.",
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

  async getTaskForm({ documentId, rowKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true },
    });
    if (!doc) return null;
    const employee = await findTaskEmployee({
      employeeId: employeeIdFromRowKey(rowKey),
      organizationId: doc.organizationId,
    });
    const config = normalizeFinishedProductDocumentConfig(doc.config);
    return buildForm(config, employee?.name ?? null);
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;
    // Сотрудник из rowKey (внешний сервис) — только своей организации.
    const doc = await db.journalDocument.findUnique({ where: { id: documentId }, select: { organizationId: true } });
    const employee = await findTaskEmployee({ employeeId, organizationId: doc?.organizationId });
    if (!employee) return false;
    const written = await appendFinishedProductRows({
      documentId,
      employee,
      todayKey,
      entries: [{ rowKey, values: values ?? {} }],
    });
    return written > 0;
  },
};

function stringValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : undefined;
}

/**
 * Записать строки бракеража (QR, TasksFlow, «Несколько блюд» по QR) под
 * блокировкой документа. Повторное выполнение той же задачи (тот же
 * `rowKey`) обновляет свою строку, не трогая остальные её поля: время с
 * сайта, свои колонки, вес, подписи. Возвращает число записанных строк.
 */
export async function appendFinishedProductRows(params: {
  documentId: string;
  /** Уже сверенный с организацией документа сотрудник (findTaskEmployee). */
  employee: { id: string; name: string; positionTitle: string | null };
  todayKey: string;
  entries: Array<{ rowKey: string; values: Record<string, unknown> }>;
}): Promise<number> {
  const result = await withDocumentConfigLock(params.documentId, async (doc) => {
    if (doc.templateCode !== TEMPLATE_CODE) return null;
    const employee = params.employee;
    const config = normalizeFinishedProductDocumentConfig(doc.config);
    // Бракераж проводит комиссия: при заданном составе строку подписывают её
    // члены, «проверяющий документа» молча не подставляется.
    const inspector = hasCommission(config)
      ? null
      : await findTaskEmployee({ employeeId: doc.verifierUserId, organizationId: doc.organizationId });
    const rows = [...config.rows];
    let written = 0;
    for (const entry of params.entries) {
      const values = entry.values;
      const productionTime = stringValue(values.productionTime) ?? "";
      const portionWeight = stringValue(values.portionWeight);
      const note = stringValue(values.note);
      const patch: Partial<FinishedProductDocumentRow> = {
        productionDateTime: `${params.todayKey} ${productionTime}`.trim(),
        productName: stringValue(values.productName) ?? "",
        organoleptic: stringValue(values.organoleptic) ?? "",
        productTemp: stringValue(values.productTemp) ?? "",
        correctiveAction: stringValue(values.correctiveAction) ?? "",
        releaseAllowed: values.releaseAllowed === "no" ? "no" : "yes",
        ...(portionWeight !== undefined ? { portionWeight } : {}),
        ...(note !== undefined ? { note } : {}),
      };
      const existingIndex = rows.findIndex((row) => row.sourceRowKey === entry.rowKey);
      if (existingIndex >= 0) {
        rows[existingIndex] = createFinishedProductRow({ ...rows[existingIndex], ...patch });
      } else {
        rows.push(
          createFinishedProductRow({
            ...patch,
            id: `bracerage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            responsiblePerson: employee.name ?? "",
            inspectorName: inspector?.name ?? "",
            sourceRowKey: entry.rowKey,
          })
        );
      }
      written += 1;
    }
    // Пустая строка-заглушка нового документа не нужна, когда пришли настоящие.
    const cleaned = rows.filter(
      (row) => row.productName.trim() !== "" || Boolean(row.sourceRowKey) || row.productionDateTime.trim() !== ""
    );
    const next: FinishedProductDocumentConfig = { ...config, rows: cleaned };
    return { config: next as unknown as Prisma.InputJsonValue, result: written };
  });
  return result ?? 0;
}
