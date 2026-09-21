/**
 * TasksFlow adapter for «Журнал контроля интенсивного охлаждения
 * горячих блюд» (intensive_cooling).
 *
 * В отличие от cleaning/hygiene/cold_equipment, этот журнал хранит
 * данные НЕ в JournalDocumentEntry, а внутри document.config.rows[].
 * Каждое «охлаждение» = новая запись в этом массиве.
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = append to config.rows внутри journalDocument.config;
 *                    dishName / productionDate / hour / minute /
 *                    startTemperature / endTemperature / comment /
 *                    responsibleTitle / responsibleUserId берутся из
 *                    полей формы.
 *   • form         = текст блюда + 2 числа (t° начальная и конечная) +
 *                    текст времени «ЧЧ:ММ» + комментарий.
 */
import { db } from "@/lib/db";
import {
  INTENSIVE_COOLING_TEMPLATE_CODE,
  snapshotIntensiveCoolingRow,
  type IntensiveCoolingRow,
  type IntensiveCoolingRowHistoryEntry,
} from "@/lib/intensive-cooling-document";
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

const TEMPLATE_CODE = INTENSIVE_COOLING_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

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

function buildForm(
  employeeName: string | null,
  prefill: IntensiveCoolingRow | null,
): TaskFormSchema {
  // Если есть уже сохранённая запись для этого row — подставляем её
  // как defaultValue. Это нужно для UX «открыть выполненную задачу
  // и поправить данные»: юзер видит свои значения и может изменить,
  // вместо ввода заново.
  const productionTime =
    prefill && prefill.productionHour && prefill.productionMinute
      ? `${prefill.productionHour}:${prefill.productionMinute}`
      : "";
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "запишите контроль интенсивного охлаждения горячего блюда. " +
      "Начальная температура должна быть 75 °C и выше, конечная — не " +
      "более 6 °C через 90 минут.",
    submitLabel: prefill ? "Сохранить изменения" : "Сохранить замер",
    fields: [
      {
        type: "text",
        key: "dishName",
        label: "Блюдо",
        required: true,
        placeholder: "Например: борщ",
        maxLength: 120,
        defaultValue: prefill?.dishName ?? undefined,
      },
      {
        type: "time",
        key: "productionTime",
        label: "Время выпуска",
        required: true,
        placeholder: "14:00",
        defaultValue: productionTime || undefined,
      },
      {
        type: "number",
        key: "startTemperature",
        label: "Температура в начале охлаждения",
        unit: "°C",
        required: true,
        min: 0,
        max: 120,
        step: 0.5,
        defaultValue: prefill?.startTemperature || undefined,
      },
      {
        type: "number",
        key: "endTemperature",
        label: "Температура в конце охлаждения",
        unit: "°C",
        required: true,
        min: -20,
        max: 120,
        step: 0.5,
        defaultValue: prefill?.endTemperature || undefined,
      },
      {
        type: "text",
        key: "comment",
        label: "Комментарий / корректирующие действия",
        multiline: true,
        maxLength: 300,
        defaultValue: prefill?.comment || undefined,
      },
    ],
  };
}

export const intensiveCoolingAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Интенсивное охлаждение горячих блюд",
    description:
      "Записать замер начальной и конечной температуры после охлаждения.",
    iconName: "thermometer-snowflake",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Интенсивное охлаждение · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "После охлаждения блюда запишите t° начала и конца.",
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
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true },
    });
    const emp = await findTaskEmployee({
      employeeId,
      organizationId: doc?.organizationId,
    });
    // Подтягиваем previously saved row (если задачу выполняли раньше),
    // чтобы форма открылась с теми же значениями. UX «нажал на круг
    // выполненной → редактирую данные».
    const cfg = (doc?.config as { rows?: IntensiveCoolingRow[] }) ?? {};
    const existing = Array.isArray(cfg.rows)
      ? cfg.rows.find((r) => r.sourceRowKey === rowKey) ?? null
      : null;
    return buildForm(emp?.name ?? null, existing);
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
    const currentConfig = (doc.config as { rows?: IntensiveCoolingRow[] }) ?? {};
    const existingRows = Array.isArray(currentConfig.rows)
      ? currentConfig.rows
      : [];

    const { hour, minute } = splitTime(values?.productionTime);
    // Upsert-by-sourceRowKey: if this TF task already produced a row
    // here, update it in place; otherwise append. Prevents duplicate
    // rows when TF task gets re-completed (admin un- then re-marks,
    // worker taps «Готово» twice, etc.).
    const existingIndex = existingRows.findIndex(
      (r) => r.sourceRowKey === rowKey
    );
    const existingRow =
      existingIndex >= 0 ? existingRows[existingIndex] : null;
    const existingId =
      existingRow?.id ??
      `cooling-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseRow: IntensiveCoolingRow = {
      id: existingId,
      productionDate: todayKey,
      productionHour: hour,
      productionMinute: minute,
      dishName:
        typeof values?.dishName === "string" ? values.dishName.trim() : "",
      startTemperature:
        values?.startTemperature !== null && values?.startTemperature !== undefined
          ? String(values.startTemperature)
          : "",
      endTemperature:
        values?.endTemperature !== null && values?.endTemperature !== undefined
          ? String(values.endTemperature)
          : "",
      correctiveAction:
        typeof values?.comment === "string" ? values.comment : "",
      comment: typeof values?.comment === "string" ? values.comment : "",
      responsibleTitle: employee?.positionTitle ?? "",
      responsibleUserId: employeeId,
      sourceRowKey: rowKey,
    };

    // Audit trail: when re-completing an existing row with values
    // that actually differ, push the OLD snapshot into history before
    // overwriting. We DON'T append a history entry if values are
    // identical (e.g. worker tapped «Готово» twice with no edits).
    let row: IntensiveCoolingRow = baseRow;
    if (existingRow) {
      const prevSnapshot = snapshotIntensiveCoolingRow(existingRow);
      const nextSnapshot = snapshotIntensiveCoolingRow(baseRow);
      const changed = (Object.keys(prevSnapshot) as Array<
        keyof typeof prevSnapshot
      >).some((k) => prevSnapshot[k] !== nextSnapshot[k]);
      const previousHistory = Array.isArray(existingRow.history)
        ? existingRow.history
        : [];
      const nextHistory: IntensiveCoolingRowHistoryEntry[] = changed
        ? [
            ...previousHistory,
            {
              at: new Date().toISOString(),
              by: employeeId,
              byName: employee?.name ?? null,
              prev: prevSnapshot,
            },
          ]
        : previousHistory;
      row = nextHistory.length > 0 ? { ...baseRow, history: nextHistory } : baseRow;
    }

    const nextRows =
      existingIndex >= 0
        ? existingRows.map((r, i) => (i === existingIndex ? row : r))
        : [...existingRows, row];
    const nextConfig = {
      ...currentConfig,
      rows: nextRows,
    };

    await db.journalDocument.update({
      where: { id: documentId },
      data: { config: nextConfig },
    });
    return true;
  },
};
