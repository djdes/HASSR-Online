/**
 * TasksFlow adapter for «Журнал учета дезинфекции, дезинсекции и
 * дератизации» (pest_control).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert, data матчит
 *                    PestControlEntryData (see pest-control-document.ts)
 *   • form         = select «Тип мероприятия» (дез/десинс/дератизация) +
 *                    text «Помещение/объём» + text «Препарат» +
 *                    time «Час:мин» + text «Примечание»
 */
import { db } from "@/lib/db";
import {
  PEST_CONTROL_TEMPLATE_CODE,
  type PestControlEntryData,
} from "@/lib/pest-control-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormSchema } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const TEMPLATE_CODE = PEST_CONTROL_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function buildPestForm(employeeName: string | null): TaskFormSchema {
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "запишите проведённое мероприятие по дезинфекции / дезинсекции / " +
      "дератизации. Все поля кроме примечания — обязательные.",
    submitLabel: "Записать обработку",
    fields: [
      {
        type: "select",
        key: "event",
        label: "Тип мероприятия",
        required: true,
        options: [
          { value: "disinfection", label: "Дезинфекция" },
          { value: "disinsection", label: "Дезинсекция" },
          { value: "deratization", label: "Дератизация" },
        ],
      },
      {
        type: "text",
        key: "areaOrVolume",
        label: "Помещение или объём",
        required: true,
        placeholder: "Например: горячий цех, 45 м²",
        maxLength: 200,
      },
      {
        type: "text",
        key: "treatmentProduct",
        label: "Препарат / концентрация",
        required: true,
        placeholder: "Например: Ph Дез-5 0,5%",
        maxLength: 200,
      },
      {
        type: "time",
        key: "performedTime",
        label: "Время проведения",
        required: true,
        placeholder: "14:30",
      },
      {
        type: "text",
        key: "note",
        label: "Примечание",
        multiline: true,
        maxLength: 300,
        placeholder: "Например: полная обработка всех поверхностей",
      },
    ],
  };
}

const EVENT_LABELS: Record<string, string> = {
  disinfection: "Дезинфекция",
  disinsection: "Дезинсекция",
  deratization: "Дератизация",
};

function splitTime(raw: unknown): { hour: string; minute: string } {
  if (typeof raw !== "string") return { hour: "", minute: "" };
  const m = /^(\d{1,2})[:.]?(\d{0,2})$/.exec(raw.trim());
  if (!m) return { hour: "", minute: "" };
  const hh = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const mm = Math.min(59, Math.max(0, Number(m[2] || 0) || 0));
  return {
    hour: String(hh).padStart(2, "0"),
    minute: String(mm).padStart(2, "0"),
  };
}

export const pestControlAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Дезинфекция / дезинсекция / дератизация",
    description: "Одноразовая обработка помещения — записать факт и препарат.",
    iconName: "bug",
  },

  scheduleForRow(): TaskSchedule {
    // Не обязательно ежедневно — админ всё равно пошлёт по мере надобности;
    // weekDays покрыто «все» так как TasksFlow требует массив.
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Обработка помещения · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Запишите факт обработки после её завершения.",
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
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return buildPestForm(null);
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true },
    });
    const employee = await findTaskEmployee({
      employeeId,
      organizationId: doc?.organizationId,
    });
    return buildPestForm(employee?.name ?? null);
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

    const { hour, minute } = splitTime(values?.performedTime);

    const eventRaw =
      typeof values?.event === "string" ? values.event : "disinfection";
    const eventLabel = EVENT_LABELS[eventRaw] || eventRaw;

    const data: PestControlEntryData = {
      performedDate: todayKey,
      performedHour: hour,
      performedMinute: minute,
      timeSpecified: Boolean(hour || minute),
      event: eventLabel,
      areaOrVolume:
        typeof values?.areaOrVolume === "string" ? values.areaOrVolume : "",
      treatmentProduct:
        typeof values?.treatmentProduct === "string"
          ? values.treatmentProduct
          : "",
      note: typeof values?.note === "string" ? values.note : "",
      performedBy: employee?.name ?? "",
      acceptedRole: "",
      acceptedEmployeeId: "",
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
