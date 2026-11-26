/**
 * TasksFlow adapter for «Журнал выдачи СИЗ» (ppe_issuance).
 *
 * Mapping:
 *   • adapter row  = employee receiving PPE (rowKey = ppe-employee-<userId>)
 *   • completion   = append a new PpeIssuanceRow to config.rows[]
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  PPE_ISSUANCE_TEMPLATE_CODE,
  type PpeIssuanceConfig,
  type PpeIssuanceRow,
  createPpeIssuanceRow,
} from "@/lib/ppe-issuance-document";
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

const TEMPLATE_CODE = PPE_ISSUANCE_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "maskCount", label: "Масок (шт.)", required: false, maxLength: 50, placeholder: "0" },
    { type: "text", key: "gloveCount", label: "Перчаток (пар)", required: false, maxLength: 50, placeholder: "0" },
    { type: "text", key: "shoePairsCount", label: "Обуви (пар)", required: false, maxLength: 50, placeholder: "0" },
    { type: "text", key: "clothingSetsCount", label: "Костюмов (компл.)", required: false, maxLength: 50, placeholder: "0" },
    { type: "text", key: "capCount", label: "Шапочек (шт.)", required: false, maxLength: 50, placeholder: "0" },
  ];
  return {
    intro: "Оформите выдачу средств индивидуальной защиты сотруднику.",
    submitLabel: "Сохранить выдачу",
    fields,
  };
}

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export const ppeIssuanceAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Выдача СИЗ",
    description: "Журнал учёта выдачи средств индивидуальной защиты",
    iconName: "shield-check",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Выдача СИЗ · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Оформите выдачу СИЗ."].join("\n");
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
        rowKey: `ppe-employee-${emp.id}`,
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

      // Защита от пустого doc.config — без `?? {}` `[...currentConfig.rows]`
      // падает с null.
      const rawConfig = (doc.config ?? {}) as Partial<PpeIssuanceConfig>;
      const currentConfig: PpeIssuanceConfig = {
        ...rawConfig,
        rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
      } as PpeIssuanceConfig;

      const newRow: PpeIssuanceRow = createPpeIssuanceRow({
        issueDate: todayKey,
        recipientUserId: employeeId,
        recipientTitle: employee?.positionTitle ?? "",
        issuerUserId: employeeId,
        issuerTitle: employee?.positionTitle ?? "",
        maskCount: safeNumber(values?.maskCount),
        gloveCount: safeNumber(values?.gloveCount),
        shoePairsCount: safeNumber(values?.shoePairsCount),
        clothingSetsCount: safeNumber(values?.clothingSetsCount),
        capCount: safeNumber(values?.capCount),
      });

      const nextConfig: PpeIssuanceConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
      return { config: nextConfig as unknown as Prisma.InputJsonValue, result: true };
    });
    return written === true;
  },
};
