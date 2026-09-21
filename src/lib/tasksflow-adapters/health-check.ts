/**
 * TasksFlow adapter for the «Журнал здоровья» (health_check).
 *
 * Mapping is близок к hygiene:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert
 *                    (documentId, employeeId, date=today,
 *                     data={signed, measures})
 *   • form         = boolean «Подтверждаю отсутствие жалоб» +
 *                    text «Меры / замечания» (необязательно)
 *
 * Journal fields see HealthEntryData in src/lib/hygiene-document.ts.
 */
import { db } from "@/lib/db";
import type { HealthEntryData } from "@/lib/hygiene-document";
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

const TEMPLATE_CODE = "health_check";

const HEALTH_TASK_FORM: TaskFormSchema = {
  intro:
    "Отметьте своё состояние перед сменой. При любых симптомах — " +
    "укажите их в поле «Меры» и сообщите начальнику.",
  submitLabel: "Сохранить",
  fields: [
    {
      type: "boolean",
      key: "signed",
      label: "Подтверждаю: жалоб на здоровье нет",
      defaultValue: true,
    },
    {
      type: "text",
      key: "measures",
      label: "Меры / замечания",
      placeholder: "Если есть жалобы, опишите кратко",
      multiline: true,
      maxLength: 500,
    },
  ],
};

const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export const healthCheckAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Журнал здоровья",
    description:
      "Ежедневный опрос о самочувствии с подтверждением перед сменой.",
    iconName: "heart",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Здоровье · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return `Журнал: ${doc.documentTitle}\nПериод: ${doc.period.from} — ${doc.period.to}`;
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
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return HEALTH_TASK_FORM;
    const [employee, yesterday] = await Promise.all([
      db.journalDocument
        .findUnique({ where: { id: documentId }, select: { organizationId: true } })
        .then((doc) =>
          findTaskEmployee({ employeeId, organizationId: doc?.organizationId })
        ),
      // Smart-default: подтянуть «signed» и «measures» из вчерашней
      // записи. См. src/lib/smart-defaults.ts.
      (async () => {
        const { getYesterdayEntryData } = await import(
          "@/lib/smart-defaults"
        );
        return getYesterdayEntryData(documentId, employeeId);
      })(),
    ]);
    if (!employee) return HEALTH_TASK_FORM;

    const fields: TaskFormField[] = HEALTH_TASK_FORM.fields.map((f) => {
      if (!yesterday) return f;
      if (
        f.type === "boolean" &&
        f.key === "signed" &&
        typeof yesterday.signed === "boolean"
      ) {
        return { ...f, defaultValue: yesterday.signed };
      }
      // measures обычно пустое — НЕ pre-fill, чтобы не тащить устаревшие
      // жалобы. Свежий день — свежий контекст.
      return f;
    });

    return {
      ...HEALTH_TASK_FORM,
      intro: `${employee.name}, подтвердите что сегодня чувствуете себя хорошо.`,
      fields,
    };
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;
    const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true },
    });
    if (!doc) return false;
    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;

    const signed =
      typeof values?.signed === "boolean"
        ? values.signed
        : values?.signed === "true"
        ? true
        : null;
    const measures =
      typeof values?.measures === "string" ? values.measures.trim() : null;
    const data: HealthEntryData = {
      signed,
      measures: measures || null,
    };

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: { documentId, employeeId, date: dateObj },
      },
      create: { documentId, employeeId, date: dateObj, data },
      update: { data },
    });
    return true;
  },
};
