/**
 * TasksFlow adapter for «Журнал регистрации жалоб» (complaint_register).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = employee-<userId>)
 *   • completion   = append a new ComplaintRow to config.rows[]
 */
import { db } from "@/lib/db";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  COMPLAINT_REGISTER_TEMPLATE_CODE,
  type ComplaintDocumentConfig,
  normalizeComplaintConfig,
  buildComplaintRow,
  COMPLAINT_RECEIPT_OPTIONS,
} from "@/lib/complaint-document";
import { toDateKey } from "@/lib/hygiene-document";
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

const TEMPLATE_CODE = COMPLAINT_REGISTER_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "applicantName", label: "ФИО заявителя", required: true, maxLength: 200, placeholder: "Иванов И.И." },
    { type: "select", key: "complaintReceiptForm", label: "Форма получения жалобы", required: true, options: COMPLAINT_RECEIPT_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
    { type: "text", key: "applicantDetails", label: "Контактные данные заявителя", required: false, maxLength: 300, placeholder: "Телефон / email / адрес" },
    { type: "text", key: "complaintContent", label: "Содержание жалобы", required: true, multiline: true, maxLength: 500, placeholder: "Опишите суть жалобы" },
    { type: "text", key: "decisionSummary", label: "Решение по жалобе", required: false, multiline: true, maxLength: 400, placeholder: "Какие меры приняты" },
  ];
  return {
    intro: "Зарегистрируйте жалобу потребителя.",
    submitLabel: "Сохранить жалобу",
    fields,
  };
}

export const complaintRegisterAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Жалобы",
    description: "Регистрация жалоб потребителей",
    iconName: "message-square-warning",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Жалоба · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Зарегистрируйте полученную жалобу."].join("\n");
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
    // Жалобу принимает только сотрудник организации документа: id пришёл
    // из rowKey внешнего сервиса.
    const employee = await findTaskEmployee({
      employeeId,
      organizationId: doc.organizationId,
    });
    if (!employee) return false;

    const currentConfig = normalizeComplaintConfig(doc.config) as ComplaintDocumentConfig;

    const newRow = buildComplaintRow({
      receiptDate: todayKey,
      applicantName: typeof values?.applicantName === "string" ? values.applicantName : "",
      complaintReceiptForm: typeof values?.complaintReceiptForm === "string" ? values.complaintReceiptForm : COMPLAINT_RECEIPT_OPTIONS[0].value,
      applicantDetails: typeof values?.applicantDetails === "string" ? values.applicantDetails : "",
      complaintContent: typeof values?.complaintContent === "string" ? values.complaintContent : "",
      decisionDate: todayKey,
      decisionSummary: typeof values?.decisionSummary === "string" ? values.decisionSummary : "",
    });

    const nextConfig: ComplaintDocumentConfig = { ...currentConfig, rows: [...currentConfig.rows, newRow] };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
