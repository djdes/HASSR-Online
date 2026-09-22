/**
 * TasksFlow adapter for «Журнал учета работы УФ бактерицидной
 * установки» (uv_lamp_runtime).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert, data = {startTime,
 *                    endTime} в формате "HH:MM"
 *   • form         = 2 time-like поля («Время включения», «Время
 *                    выключения»). На клиенте они рендерятся как
 *                    text с placeholder — в DSL пока нет field.type
 *                    = "time", подойдёт text с явным форматом.
 */
import { db } from "@/lib/db";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  appendUvRuntimeSession,
  isUvRuntimeEntryDataEmpty,
  normalizeUvRuntimeEntryData,
  type UvRuntimeEntryData,
} from "@/lib/uv-lamp-runtime-document";
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

const TEMPLATE_CODE = UV_LAMP_RUNTIME_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function buildUvTaskForm(employeeName: string | null): TaskFormSchema {
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "запишите время включения и выключения бактерицидной установки " +
      "за смену. Формат: 24-часовой, например 08:30.",
    submitLabel: "Сохранить смену",
    fields: [
      {
        type: "time",
        key: "startTime",
        label: "Время включения",
        placeholder: "08:00",
        required: true,
      },
      {
        type: "time",
        key: "endTime",
        label: "Время выключения",
        placeholder: "09:00",
        required: true,
      },
    ],
  };
}

function normalizeTime(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  // Accept "8", "8:30", "08:30", "8.30" and normalise to HH:MM.
  const match = /^(\d{1,2})[:.]?(\d{0,2})$/.exec(trimmed);
  if (!match) return trimmed;
  const hh = Math.min(23, Math.max(0, Number(match[1]) || 0));
  const mm = Math.min(59, Math.max(0, Number(match[2] || 0) || 0));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export const uvLampRuntimeAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "УФ бактерицидная установка",
    description: "Журнал работы УФ-лампы — время включения и выключения за смену.",
    iconName: "radiation",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `УФ-лампа · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "После смены запишите время включения и выключения лампы.",
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
    if (!employeeId) return buildUvTaskForm(null);
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true },
    });
    const employee = await findTaskEmployee({
      employeeId,
      organizationId: doc?.organizationId,
    });
    return buildUvTaskForm(employee?.name ?? null);
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

    const session = {
      startTime: normalizeTime(values?.startTime),
      endTime: normalizeTime(values?.endTime),
    };
    // Сеанс дописывается к уже записанным за день (раньше вся запись
    // перезаписывалась и дополнительные сеансы пропадали).
    const existing = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId, employeeId, date: dateObj } },
      select: { data: true },
    });
    const previous = normalizeUvRuntimeEntryData(existing?.data ?? null);
    const data: UvRuntimeEntryData = isUvRuntimeEntryDataEmpty(previous)
      ? session
      : appendUvRuntimeSession(previous, session);

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
