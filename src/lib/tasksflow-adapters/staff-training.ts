/**
 * TasksFlow adapter for «Журнал регистрации инструктажей» (staff_training).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new StaffTrainingRow to config.rows[]
 */
import { db } from "@/lib/db";
import {
  STAFF_TRAINING_TEMPLATE_CODE,
  TRAINING_TYPES,
  TRAINING_TOPICS,
  ATTESTATION_RESULTS,
  type StaffTrainingConfig,
  type StaffTrainingRow,
  createStaffTrainingRow,
} from "@/lib/staff-training-document";
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

const TEMPLATE_CODE = STAFF_TRAINING_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "select", key: "topic", label: "Тема инструктажа", required: true, options: TRAINING_TOPICS.map((t) => ({ value: t.value, label: t.label })) },
    { type: "select", key: "trainingType", label: "Вид инструктажа", required: true, options: TRAINING_TYPES.map((t) => ({ value: t.value, label: t.label })), defaultValue: "primary" },
    { type: "text", key: "instructorName", label: "Кто провёл инструктаж", required: true, maxLength: 200, placeholder: "ФИО инструктора" },
    { type: "select", key: "attestationResult", label: "Результат аттестации", required: false, options: [{ value: "", label: "—" }, ...ATTESTATION_RESULTS.map((r) => ({ value: r.value, label: r.label }))], defaultValue: "" },
    { type: "text", key: "unscheduledReason", label: "Причина внепланового инструктажа", required: false, maxLength: 300, placeholder: "Заполняется только для внепланового" },
  ];
  return {
    intro: "Оформите запись об инструктаже сотрудника.",
    submitLabel: "Сохранить инструктаж",
    fields,
  };
}

export const staffTrainingAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Инструктажи",
    description: "Журнал регистрации инструктажей сотрудников",
    iconName: "graduation-cap",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Инструктаж · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Оформите запись об инструктаже."].join("\n");
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

    // Защита от пустого doc.config — без `?? {}` `currentConfig.rows`
    // падает с «Cannot read properties of null».
    const rawConfig = (doc.config ?? {}) as Partial<StaffTrainingConfig>;
    const currentConfig: StaffTrainingConfig = {
      ...rawConfig,
      rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
    } as StaffTrainingConfig;

    const newRow: StaffTrainingRow = createStaffTrainingRow({
      date: todayKey,
      employeeId,
      employeeName: employee?.name ?? "",
      employeePosition: employee?.positionTitle ?? "",
      topic: TRAINING_TOPICS.find((t) => t.value === values?.topic)?.label ?? (typeof values?.topic === "string" ? values.topic : ""),
      trainingType: typeof values?.trainingType === "string" ? values.trainingType : "primary",
      instructorName: typeof values?.instructorName === "string" ? values.instructorName : "",
      attestationResult: (values?.attestationResult as "passed" | "failed" | "") || "",
      unscheduledReason: typeof values?.unscheduledReason === "string" ? values.unscheduledReason : "",
    });

    const nextConfig: StaffTrainingConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
