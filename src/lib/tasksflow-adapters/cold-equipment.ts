/**
 * TasksFlow adapter for «Журнал контроля температурного режима
 * холодильного и морозильного оборудования» (cold_equipment_control).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert with today's date +
 *                    `{responsibleTitle, temperatures: {equipmentId:
 *                    °C}}`
 *   • form         = ONE number field per equipment item in the doc's
 *                    config. Labels include expected range, units «°C»
 *                    for tap-to-enter on phone.
 *
 * Form is **dynamic** — built per document by reading its config.
 * getTaskForm is called with `documentId` so we can fetch the right
 * equipment list.
 */
import { db } from "@/lib/db";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  expandColdEquipmentReadingSlots,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
  type ColdEquipmentConfigItem,
  type ColdEquipmentDocumentConfig,
  type ColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import { OFF_NOTE_EQUIPMENT, correctionFromValues, parseOffKeys, type TaskFormField, type TaskFormSchema } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const TEMPLATE_CODE = COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Ключ поля = ключ замера (`id` для первого, `id#2` для второго): первый замер совместим со старым `t_<id>`. */
function fieldKeyForEquipment(slotKey: string) {
  return `t_${slotKey}`;
}

type NormMap = Map<string, { min: number | null; max: number | null }>;

/** Норма строки журнала, а если в ней пусто — из справочника оборудования (там «от … до …»). */
function normFor(item: ColdEquipmentConfigItem, directory: NormMap): { min: number | null; max: number | null } {
  if (typeof item.min === "number" && typeof item.max === "number") return { min: item.min, max: item.max };
  const fromDirectory = item.sourceEquipmentId ? directory.get(item.sourceEquipmentId) : null;
  return { min: item.min ?? fromDirectory?.min ?? null, max: item.max ?? fromDirectory?.max ?? null };
}

function buildFormFromConfig(
  config: ColdEquipmentDocumentConfig,
  employeeName: string | null,
  directory: NormMap = new Map()
): TaskFormSchema {
  // Поле на каждый замер дня («1-й замер», «2-й замер»), как строки в таблице журнала.
  const fields: TaskFormField[] = expandColdEquipmentReadingSlots(config).map((slot) => {
    const norm = normFor(slot, directory);
    const range = typeof norm.min === "number" && typeof norm.max === "number" ? ` · норма ${norm.min}…${norm.max}` : "";
    return {
      type: "number",
      key: fieldKeyForEquipment(slot.slotKey),
      label: `${slot.name} — ${slot.slotLabel || "t°"}${range}`,
      unit: "°C",
      required: true,
      min: -40,
      max: 30,
      step: 0.1,
    };
  });
  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "снимите показания каждого холодильника и введите температуру в °C. " +
      "Если оборудование выключено — отметьте «Выключено» в его карточке: в журнал попадёт пометка, руководитель получит уведомление.",
    submitLabel: "Сохранить замеры",
    fields,
  };
}

/**
 * Уже записанные сегодня температуры — в поля формы: повторное открытие
 * по QR показывает, что снято, и даёт поправить. Своя запись сотрудника
 * важнее чужой; чужая берётся, если своей нет (показания одни на всех).
 */
async function prefillFromToday(
  form: TaskFormSchema,
  config: ColdEquipmentDocumentConfig,
  documentId: string,
  employeeId: string | null,
  todayKey: string
): Promise<void> {
  const date = new Date(`${todayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return;
  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId, date },
    select: { employeeId: true, data: true },
  });
  if (entries.length === 0) return;
  const own = entries.find((entry) => entry.employeeId === employeeId) ?? null;
  const ordered = own ? [own, ...entries.filter((entry) => entry !== own)] : entries;
  const datas = ordered.map((entry) => normalizeColdEquipmentEntryData(entry.data ?? null));
  let filled = 0;
  const prefilledOff: string[] = [];
  const slots = expandColdEquipmentReadingSlots(config);
  for (const field of form.fields) {
    if (field.type !== "number") continue;
    const slot = slots.find((candidate) => fieldKeyForEquipment(candidate.slotKey) === field.key);
    if (!slot) continue;
    for (const data of datas) {
      const value = data.temperatures[slot.slotKey];
      if (typeof value === "number" && Number.isFinite(value)) {
        field.defaultValue = value;
        filled += 1;
        break;
      }
      if (data.corrections?.[slot.slotKey] === OFF_NOTE_EQUIPMENT) {
        prefilledOff.push(field.key);
        filled += 1;
        break;
      }
    }
  }
  if (prefilledOff.length > 0) form.prefilledOff = prefilledOff;
  if (filled > 0) {
    form.notice = `Сегодня уже записано: ${filled} из ${slots.length}. Значения подставлены — проверьте и измените, что нужно.`;
  }
}

/** Нормы из справочника оборудования для строк, где в журнале норма не задана. */
async function loadDirectoryNorms(config: ColdEquipmentDocumentConfig): Promise<NormMap> {
  const ids = config.equipment.map((item) => item.sourceEquipmentId).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return new Map();
  const rows = await db.equipment.findMany({ where: { id: { in: ids } }, select: { id: true, tempMin: true, tempMax: true } });
  return new Map(rows.map((row) => [row.id, { min: row.tempMin ?? null, max: row.tempMax ?? null }]));
}

export const coldEquipmentAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Холодильное оборудование",
    description:
      "Замер температуры всех холодильников утром и/или вечером.",
    iconName: "snowflake",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Замер t° холодильников · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Снимите показания каждого холодильника из списка в задаче.",
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
        select: {
          id: true,
          title: true,
          dateFrom: true,
          dateTo: true,
          config: true,
        },
        orderBy: { dateFrom: "desc" },
      }),
      db.user.findMany({
        where: { organizationId, isActive: true, ...NOT_COMMISSION_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    ]);

    return docs.map<AdapterDocument>((doc) => {
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: employees.map<AdapterRow>((emp) => ({
          rowKey: rowKeyForEmployee(emp.id),
          label: emp.name,
          sublabel: emp.positionTitle ?? undefined,
          responsibleUserId: emp.id,
        })),
      };
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm({ documentId, rowKey, todayKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, organizationId: true },
    });
    if (!doc) return null;
    const employee = await findTaskEmployee({
      employeeId: employeeIdFromRowKey(rowKey),
      organizationId: doc.organizationId,
    });
    const config = normalizeColdEquipmentDocumentConfig(doc.config);
    const directory = await loadDirectoryNorms(config);
    const form = buildFormFromConfig(config, employee?.name ?? null, directory);
    if (todayKey) await prefillFromToday(form, config, documentId, employeeIdFromRowKey(rowKey), todayKey);
    return form;
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
    const config = normalizeColdEquipmentDocumentConfig(doc.config);

    // Walk config.equipment, pick matching `t_<equipmentId>` value
    // from submitted form. Missing = null (equipment skipped).
    // «Выключено» — прочерк с пометкой вместо показания; комментарий «что
    // сделали» — к тем замерам, где температура вне нормы. Прежние пометки
    // той же записи сохраняем, снятую пометку «Выключено» убираем.
    const off = parseOffKeys(values ?? null);
    const correction = correctionFromValues(values ?? null);
    const prior = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId, employeeId, date: dateObj } },
      select: { data: true },
    });
    const priorData = normalizeColdEquipmentEntryData(prior?.data ?? null);
    const directory = await loadDirectoryNorms(config);
    // Значения по замерам: что прислали — записываем, чего в форме не было — оставляем как было.
    const temperatures: Record<string, number | null> = { ...priorData.temperatures };
    const corrections: Record<string, string> = { ...(priorData.corrections ?? {}) };
    // «обсл»/«рем» с наклейки: остаются, пока в замер не пришло новое значение.
    const statuses = { ...(priorData.statuses ?? {}) };
    for (const slot of expandColdEquipmentReadingSlots(config)) {
      const key = fieldKeyForEquipment(slot.slotKey);
      if (off.has(key)) {
        temperatures[slot.slotKey] = null;
        corrections[slot.slotKey] = OFF_NOTE_EQUIPMENT;
        delete statuses[slot.slotKey];
        continue;
      }
      if (!values || !(key in values)) {
        if (temperatures[slot.slotKey] === undefined) temperatures[slot.slotKey] = null;
        continue;
      }
      if (statuses[slot.slotKey] && (values[key] === null || values[key] === undefined || values[key] === "")) {
        // Пустое поле формы не снимает отметку «обсл»/«рем».
        continue;
      }
      delete statuses[slot.slotKey];
      const raw = values[key];
      if (typeof raw === "number" && Number.isFinite(raw)) temperatures[slot.slotKey] = raw;
      else if (typeof raw === "string" && raw.trim() !== "") {
        const parsed = Number(raw);
        temperatures[slot.slotKey] = Number.isFinite(parsed) ? parsed : null;
      } else temperatures[slot.slotKey] = null;
      if (corrections[slot.slotKey] === OFF_NOTE_EQUIPMENT) delete corrections[slot.slotKey];
      const t = temperatures[slot.slotKey];
      const norm = normFor(slot, directory);
      const lo = typeof norm.min === "number" && typeof norm.max === "number" ? Math.min(norm.min, norm.max) : norm.min;
      const hi = typeof norm.min === "number" && typeof norm.max === "number" ? Math.max(norm.min, norm.max) : norm.max;
      const outside = typeof t === "number" && ((typeof lo === "number" && t < lo) || (typeof hi === "number" && t > hi));
      if (outside && correction) corrections[slot.slotKey] = correction;
    }

    const data: ColdEquipmentEntryData = {
      responsibleTitle: priorData.responsibleTitle ?? null,
      temperatures,
      ...(Object.keys(corrections).length > 0 ? { corrections } : {}),
      ...(Object.keys(statuses).length > 0 ? { statuses } : {}),
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
