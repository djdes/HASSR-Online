/**
 * TasksFlow adapter for «Отчёт о внутреннем аудите» (audit_report).
 *
 * Mapping:
 *   • adapter row  = new finding (rowKey = new-finding)
 *   • completion   = append a new AuditReportFinding to config.findings[]
 */
import { db } from "@/lib/db";
import {
  AUDIT_REPORT_TEMPLATE_CODE,
  type AuditReportConfig,
  type AuditReportFinding,
  createAuditReportFinding,
} from "@/lib/audit-report-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";

const TEMPLATE_CODE = AUDIT_REPORT_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "text", key: "nonConformity", label: "Выявленное несоответствие", required: true, multiline: true, maxLength: 500, placeholder: "Описание несоответствия" },
    { type: "text", key: "correctionActions", label: "Немедленные корректирующие действия", required: false, multiline: true, maxLength: 500 },
    { type: "text", key: "correctiveActions", label: "Корректирующие действия", required: false, multiline: true, maxLength: 500 },
    { type: "text", key: "responsibleName", label: "Ответственный (ФИО)", autofill: "employeeName", required: false, maxLength: 200 },
    { type: "text", key: "responsiblePosition", label: "Должность ответственного", required: false, maxLength: 200 },
    { type: "date", key: "dueDatePlan", label: "Срок выполнения (план)", required: false },
  ];
  return {
    intro: "Добавьте новое выявленное несоответствие в отчёт аудита.",
    submitLabel: "Сохранить несоответствие",
    fields,
  };
}

export const auditReportAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Отчёт аудита",
    description: "Отчёт о внутреннем аудите",
    iconName: "file-text",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(): string {
    return `Новое несоответствие`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Добавьте выявленное несоответствие."].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const docs = await db.journalDocument.findMany({
      where: { organizationId, status: "active", template: { code: TEMPLATE_CODE } },
      select: {
        id: true,
        title: true,
        dateFrom: true,
        dateTo: true,
        config: true,
        responsibleUserId: true,
      },
      orderBy: { dateFrom: "desc" },
    });
    return docs.map<AdapterDocument>((doc) => {
      const config = doc.config as AuditReportConfig | null;
      const cfgResp = (config as unknown as { responsibleEmployeeId?: string | null } | null)
        ?.responsibleEmployeeId;
      const docResp = cfgResp ?? doc.responsibleUserId ?? null;
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: [{ rowKey: "new-finding", label: "Добавить несоответствие", responsibleUserId: docResp }],
      };
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm() {
    return buildForm();
  },

  async applyRemoteCompletion({ documentId, completed, values }) {
    if (!completed) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, template: { select: { code: true } } },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE) return false;

    // Защита от пустого doc.config — `as` не проверяет рантайм, и без
    // `?? {}` spread `[...currentConfig.findings]` падает с null.
    const rawConfig = (doc.config ?? {}) as Partial<AuditReportConfig>;
    const currentConfig: AuditReportConfig = {
      ...rawConfig,
      findings: Array.isArray(rawConfig.findings) ? rawConfig.findings : [],
    } as AuditReportConfig;

    const newFinding: AuditReportFinding = createAuditReportFinding({
      nonConformity: typeof values?.nonConformity === "string" ? values.nonConformity : "",
      correctionActions: typeof values?.correctionActions === "string" ? values.correctionActions : "",
      correctiveActions: typeof values?.correctiveActions === "string" ? values.correctiveActions : "",
      responsibleName: typeof values?.responsibleName === "string" ? values.responsibleName : "",
      responsiblePosition: typeof values?.responsiblePosition === "string" ? values.responsiblePosition : "",
      dueDatePlan: typeof values?.dueDatePlan === "string" ? values.dueDatePlan : new Date().toISOString().slice(0, 10),
    });

    const nextConfig: AuditReportConfig = { ...currentConfig, findings: [...currentConfig.findings, newFinding] };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
