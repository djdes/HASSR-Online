/**
 * TasksFlow adapter for the «Гигиенический журнал».
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert with
 *                    (documentId, employeeId, date=today, data={status, temperatureAbove37})
 *   • form         = dropdown «Состояние» + yes/no «Температура выше 37°C»
 *
 * Unlike cleaning, hygiene does NOT auto-push from PATCH. The admin
 * explicitly creates tasks from TasksFlow's «Журнальный режим» —
 * picking a document and the set of workers. Each selected worker gets
 * one task bound to `employee-<theirId>`, and completing it fills the
 * corresponding cell for today.
 */
import { db } from "@/lib/db";
import {
  HYGIENE_STATUS_OPTIONS,
  type HygieneEntryData,
  type HygieneStatus,
} from "@/lib/hygiene-document";
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

const HYGIENE_CODE = "hygiene";
const CATEGORY = "WeSetup · Гигиена";

const HYGIENE_TASK_FORM: TaskFormSchema = {
  intro:
    "Отметьте своё состояние перед сменой. Если есть симптомы — выберите " +
    "«Болен» и сообщите начальнику.",
  submitLabel: "Сохранить",
  fields: [
    {
      type: "select",
      key: "status",
      label: "Состояние",
      required: true,
      options: HYGIENE_STATUS_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        code: opt.code,
      })),
      defaultValue: "healthy",
    },
    {
      type: "boolean",
      key: "temperatureAbove37",
      label: "Температура выше 37°C",
      defaultValue: false,
    },
  ],
};

export const hygieneAdapter: JournalAdapter = {
  meta: {
    templateCode: HYGIENE_CODE,
    label: "Гигиенический журнал",
    description:
      "Ежедневный опрос о состоянии здоровья + температура. Задача каждому сотруднику.",
    iconName: "heart-pulse",
  },

  scheduleForRow(_row, _doc): TaskSchedule {
    // Daily — hygiene journal is checked every shift start.
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Гигиена · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Отметьте состояние в начале смены.",
    ].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const [docs, employees] = await Promise.all([
      db.journalDocument.findMany({
        where: {
          organizationId,
          status: "active",
          template: { code: HYGIENE_CODE },
        },
        select: {
          id: true,
          title: true,
          dateFrom: true,
          dateTo: true,
        },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
        select: {
          id: true,
          name: true,
          role: true,
          positionTitle: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ]);

    // Date helpers without pulling coerceUtcDate — inline to avoid
    // cross-lib import weight.
    const toDateKey = (d: Date) => {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

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

  /**
   * Hygiene has no push-on-PATCH semantics — tasks are created explicitly
   * by an admin in TasksFlow, not derived from the document config. So
   * this is a no-op that returns an empty report.
   */
  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm({ documentId, rowKey }) {
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return HYGIENE_TASK_FORM;
    const [employee, yesterday] = await Promise.all([
      db.journalDocument
        .findUnique({ where: { id: documentId }, select: { organizationId: true } })
        .then((doc) =>
          findTaskEmployee({ employeeId, organizationId: doc?.organizationId })
        ),
      // Smart-default из вчерашней entry: если повар вчера ставил
      // «healthy», скорее всего и сегодня то же. Pre-fill экономит
      // тап и не блокирует «осознанное подтверждение submit'ом».
      // См. src/lib/smart-defaults.ts § getYesterdayEntryData.
      (async () => {
        const { getYesterdayEntryData } = await import(
          "@/lib/smart-defaults"
        );
        return getYesterdayEntryData(documentId, employeeId);
      })(),
    ]);
    if (!employee) return HYGIENE_TASK_FORM;

    // Override defaults в форме если есть данные за вчера. Cast в
    // TaskFormField нужен потому что spread теряет discriminated-union
    // narrowing на тип field'а.
    const fields: TaskFormField[] = HYGIENE_TASK_FORM.fields.map((f) => {
      if (!yesterday) return f;
      if (
        f.type === "select" &&
        f.key === "status" &&
        typeof yesterday.status === "string"
      ) {
        return { ...f, defaultValue: yesterday.status };
      }
      if (
        f.type === "boolean" &&
        f.key === "temperatureAbove37" &&
        typeof yesterday.temperatureAbove37 === "boolean"
      ) {
        return { ...f, defaultValue: yesterday.temperatureAbove37 };
      }
      return f;
    });

    return {
      ...HYGIENE_TASK_FORM,
      intro:
        `${employee.name}, отметьте своё состояние перед сменой. ` +
        `Если есть симптомы — выберите «Болен» и сообщите начальнику.`,
      fields,
    };
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;

    // Pull the submitted values (status + temperatureAbove37). Silently
    // accept missing values as {status: "healthy"} — employees who don't
    // see the form (older TasksFlow) still get a sensible journal entry.
    const rawStatus = values?.status;
    const isValidStatus = (v: unknown): v is HygieneStatus =>
      typeof v === "string" &&
      HYGIENE_STATUS_OPTIONS.some((opt) => opt.value === v);
    const status: HygieneStatus = isValidStatus(rawStatus) ? rawStatus : "healthy";

    const rawTemp = values?.temperatureAbove37;
    const temperatureAbove37: boolean | null =
      typeof rawTemp === "boolean"
        ? rawTemp
        : typeof rawTemp === "string"
        ? rawTemp === "true"
        : null;

    const data: HygieneEntryData = { status, temperatureAbove37 };
    const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true },
    });
    if (!doc) return false;
    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId,
          employeeId,
          date: dateObj,
        },
      },
      create: {
        documentId,
        employeeId,
        date: dateObj,
        data,
      },
      update: { data },
    });
    return true;
  },
};
