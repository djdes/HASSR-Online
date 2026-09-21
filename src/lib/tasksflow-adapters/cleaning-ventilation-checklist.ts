/**
 * TasksFlow adapter for «Чек-лист уборки и проветривания помещений»
 * (cleaning_ventilation_checklist).
 *
 * Процедуры журнала: дезинфекция, проветривание, влажная уборка.
 * Каждая выполняется несколько раз в день в заданное время (config
 * хранит `procedures[].times: ["08:00", "12:00", ...]`).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert с `{procedures:
 *                    {disinfection: [times], ventilation: [times],
 *                    wet_cleaning: [times]}}`. То, что сотрудник отметил
 *                    галочкой — записывается со всеми times из config
 *                    этой процедуры.
 *   • form         = ДО трёх boolean-чекбоксов (по одному на
 *                    включённую процедуру), плюс необязательный
 *                    комментарий.
 */
import { db } from "@/lib/db";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  type CleaningVentilationChecklistConfig,
  type CleaningVentilationChecklistEntryData,
} from "@/lib/cleaning-ventilation-checklist-document";
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

const TEMPLATE_CODE = CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

// Poor-man's normalize — schema of config.procedures comes with fixed
// ids; we only care about `id`, `label`, `enabled`, `times`.
function normalizeConfig(raw: unknown): CleaningVentilationChecklistConfig {
  if (!raw || typeof raw !== "object") {
    return {
      autoFillEnabled: false,
      skipWeekends: false,
      mainResponsibleTitle: "",
      mainResponsibleUserId: "",
      ventilationEnabled: true,
      customDates: [],
      hiddenDates: [],
      responsibles: [],
      procedures: [],
    };
  }
  return raw as CleaningVentilationChecklistConfig;
}

function buildForm(
  config: CleaningVentilationChecklistConfig,
  employeeName: string | null
): TaskFormSchema {
  const enabled = (config.procedures ?? []).filter(
    (p) => p.enabled !== false
  );
  const fields: TaskFormField[] = enabled.map((p) => ({
    type: "boolean" as const,
    key: `proc_${p.id}`,
    label: `${p.label}${
      Array.isArray(p.times) && p.times.length > 0
        ? ` (${p.times.join(", ")})`
        : ""
    } — выполнено`,
    defaultValue: true,
  }));
  // No free-text «Комментарий» here — CleaningVentilationChecklistEntryData
  // has no slot for it and the journal viewer doesn't render one, so the
  // worker's input would be silently dropped. Keep the form minimal.
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "отметьте выполненные процедуры чек-листа. Часы возьмутся из " +
      "графика журнала автоматически.",
    submitLabel: "Сохранить чек-лист",
    fields,
  };
}

export const cleaningVentilationChecklistAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Чек-лист уборки и проветривания",
    description:
      "Дезинфекция, проветривание, влажная уборка по графику журнала.",
    iconName: "sparkles",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Чек-лист уборки · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Отметьте выполненные процедуры в задаче.",
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
    const config = normalizeConfig(doc.config);
    return buildForm(config, employee?.name ?? null);
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey, values }) {
    if (!completed) return false;
    const employeeId = employeeIdFromRowKey(rowKey);
    if (!employeeId) return false;
    const dateObj = new Date(`${todayKey}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true },
    });
    if (!doc) return false;
    const employee = await findTaskEmployee({ employeeId, organizationId: doc.organizationId });
    if (!employee) return false;
    const config = normalizeConfig(doc.config);

    const procedures: CleaningVentilationChecklistEntryData["procedures"] = {};
    for (const p of config.procedures ?? []) {
      if (p.enabled === false) continue;
      const checked = values?.[`proc_${p.id}`];
      const done =
        checked === true ||
        checked === "true" ||
        checked === 1 ||
        checked === "1";
      if (done) {
        procedures[p.id] = Array.isArray(p.times) ? [...p.times] : [];
      }
    }

    const data: CleaningVentilationChecklistEntryData = {
      procedures,
      responsibleUserId: employeeId,
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
