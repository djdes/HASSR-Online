/**
 * TasksFlow adapter for «Журнал мойки и дезинфекции оборудования»
 * (equipment_cleaning).
 *
 * Mapping:
 *   • adapter row  = employee (rowKey = `employee-<userId>`)
 *   • completion   = JournalDocumentEntry upsert. Каждая мойка =
 *                    запись на (docId, employeeId, date=today, data =
 *                    EquipmentCleaningRowData). За один день один
 *                    сотрудник фиксируется как одна запись — для
 *                    нескольких моек в день сотрудник должен получить
 *                    отдельные задачи.
 *   • form         = оборудование + средства + концентрации +
 *                    время + результат полоскания.
 */
import { db } from "@/lib/db";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  type EquipmentCleaningRowData,
  normalizeEquipmentCleaningConfig,
} from "@/lib/equipment-cleaning-document";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormSchema, TaskFormField } from "./task-form";
import { extractEmployeeId as employeeIdFromRowKey, rowKeyForEmployee } from "./row-key";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const TEMPLATE_CODE = EQUIPMENT_CLEANING_TEMPLATE_CODE;
const toDateKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function normalizeTime(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const m = /^(\d{1,2})[:.]?(\d{0,2})$/.exec(raw.trim());
  if (!m) return "";
  const hh = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const mm = Math.min(59, Math.max(0, Number(m[2] || 0) || 0));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function buildForm(
  fieldVariant: "rinse_temperature" | "rinse_completeness",
  employeeName: string | null
): TaskFormSchema {
  const rinseField: TaskFormField =
    fieldVariant === "rinse_temperature"
      ? {
          type: "number",
          key: "rinseTemperature",
          label: "Ополаскивание",
          unit: "°C",
          min: 0,
          max: 100,
          step: 1,
          required: true,
        }
      : {
          type: "select",
          key: "rinseResult",
          label: "Полнота смываемости",
          required: true,
          options: [
            { value: "compliant", label: "Соответствует" },
            { value: "non_compliant", label: "Не соответствует" },
          ],
        };

  return {
    intro:
      (employeeName ? `${employeeName}, ` : "") +
      "запишите факт мойки и дезинфекции оборудования после её завершения.",
    submitLabel: "Сохранить мойку",
    fields: [
      {
        type: "text",
        key: "equipmentName",
        label: "Оборудование",
        required: true,
        placeholder: "Например: мясорубка",
        maxLength: 120,
      },
      {
        type: "time",
        key: "washTime",
        label: "Время",
        required: true,
        placeholder: "14:30",
      },
      {
        type: "text",
        key: "detergentName",
        label: "Моющее средство",
        placeholder: "Например: Ph Multiclean",
        maxLength: 120,
      },
      {
        type: "text",
        key: "detergentConcentration",
        label: "Концентрация моющего",
        placeholder: "1%",
        maxLength: 60,
      },
      {
        type: "text",
        key: "disinfectantName",
        label: "Дез. средство",
        placeholder: "Например: Ph Дез-5",
        maxLength: 120,
      },
      {
        type: "text",
        key: "disinfectantConcentration",
        label: "Концентрация дез.",
        placeholder: "0,5%",
        maxLength: 60,
      },
      rinseField,
    ],
  };
}

export const equipmentCleaningAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Мойка и дезинфекция оборудования",
    description:
      "Запись о мойке оборудования — средства, концентрации, время, результат.",
    iconName: "wash",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row) {
    return `Мойка оборудования · ${row.label}`;
  },

  descriptionForRow(_row, doc) {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "После мойки заполните форму из задачи.",
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
    const employee = doc
      ? await findTaskEmployee({
          employeeId: employeeIdFromRowKey(rowKey),
          organizationId: doc.organizationId,
        })
      : null;
    const fieldVariant = doc
      ? normalizeEquipmentCleaningConfig(doc.config).fieldVariant
      : "rinse_temperature";
    return buildForm(fieldVariant, employee?.name ?? null);
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

    const rinseTempRaw = values?.rinseTemperature;
    const rinseTemperature =
      typeof rinseTempRaw === "number"
        ? String(rinseTempRaw)
        : typeof rinseTempRaw === "string" && rinseTempRaw.trim() !== ""
        ? rinseTempRaw.trim()
        : null;

    const rinseResult =
      values?.rinseResult === "compliant" || values?.rinseResult === "non_compliant"
        ? values.rinseResult
        : null;

    const data: EquipmentCleaningRowData = {
      washDate: todayKey,
      washTime: normalizeTime(values?.washTime),
      equipmentName:
        typeof values?.equipmentName === "string" ? values.equipmentName : "",
      detergentName:
        typeof values?.detergentName === "string" ? values.detergentName : "",
      detergentConcentration:
        typeof values?.detergentConcentration === "string"
          ? values.detergentConcentration
          : "",
      disinfectantName:
        typeof values?.disinfectantName === "string"
          ? values.disinfectantName
          : "",
      disinfectantConcentration:
        typeof values?.disinfectantConcentration === "string"
          ? values.disinfectantConcentration
          : "",
      rinseTemperature,
      rinseResult,
      washerPosition: employee?.positionTitle ?? "",
      washerName: employee?.name ?? "",
      washerUserId: employeeId,
      controllerPosition: "",
      controllerName: "",
      controllerUserId: null,
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
