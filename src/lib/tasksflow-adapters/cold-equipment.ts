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
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
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
import type { TaskFormField, TaskFormSchema } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";

const TEMPLATE_CODE = COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function fieldKeyForEquipment(equipmentId: string) {
  return `t_${equipmentId}`;
}

function buildFormFromConfig(
  config: ColdEquipmentDocumentConfig,
  employeeName: string | null
): TaskFormSchema {
  const fields: TaskFormField[] = config.equipment.map((item) => {
    const range =
      typeof item.min === "number" && typeof item.max === "number"
        ? ` · норма ${item.min}…${item.max}`
        : "";
    return {
      type: "number",
      key: fieldKeyForEquipment(item.id),
      label: `${item.name}${range}`,
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
      "Если оборудование выключено — оставьте поле пустым и сообщите начальнику.",
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
  for (const field of form.fields) {
    if (field.type !== "number") continue;
    const item = config.equipment.find((candidate) => fieldKeyForEquipment(candidate.id) === field.key);
    if (!item) continue;
    for (const data of datas) {
      const value = data.temperatures[item.id];
      if (typeof value === "number" && Number.isFinite(value)) {
        field.defaultValue = value;
        filled += 1;
        break;
      }
    }
  }
  if (filled > 0) {
    form.notice = `Сегодня уже записано: ${filled} из ${config.equipment.length}. Значения подставлены — проверьте и измените, что нужно.`;
  }
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
        where: { organizationId, isActive: true },
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
    const form = buildFormFromConfig(config, employee?.name ?? null);
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
    const temperatures: Record<string, number | null> = {};
    for (const item of config.equipment) {
      const raw = values?.[fieldKeyForEquipment(item.id)];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        temperatures[item.id] = raw;
      } else if (typeof raw === "string" && raw.trim() !== "") {
        const parsed = Number(raw);
        temperatures[item.id] = Number.isFinite(parsed) ? parsed : null;
      } else {
        temperatures[item.id] = null;
      }
    }

    const data: ColdEquipmentEntryData = {
      responsibleTitle: null,
      temperatures,
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
