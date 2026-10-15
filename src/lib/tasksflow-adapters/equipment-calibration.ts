/**
 * TasksFlow adapter for «График поверки средств измерений» (equipment_calibration).
 *
 * Mapping:
 *   • adapter row  = equipment item (rowKey = equipment-<rowId>)
 *   • completion   = update lastCalibrationDate and note on existing row
 */
import { db } from "@/lib/db";
import {
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  type EquipmentCalibrationConfig,
  type CalibrationRow,
} from "@/lib/equipment-calibration-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";

const TEMPLATE_CODE = EQUIPMENT_CALIBRATION_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "date", key: "lastCalibrationDate", label: "Дата поверки", presentationKey: "fields.equipment_calibration.lastCalibrationDate.label", required: true },
    { type: "text", key: "note", label: "Примечание", required: false, multiline: true, maxLength: 300 },
  ];
  return {
    intro: "Обновите дату поверки средства измерений.",
    submitLabel: "Сохранить поверку",
    fields,
  };
}

export const equipmentCalibrationAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Поверка средств измерений",
    description: "График поверки средств измерений",
    iconName: "ruler",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Поверка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Обновите дату поверки."].join("\n");
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
      const config = doc.config as EquipmentCalibrationConfig;
      const cfgResp = (config as unknown as { responsibleEmployeeId?: string | null })
        ?.responsibleEmployeeId;
      const docResp = cfgResp ?? doc.responsibleUserId ?? null;
      const rows: AdapterRow[] = (config?.rows ?? []).map<AdapterRow>((row) => ({
        rowKey: `equipment-${row.id}`,
        label: row.equipmentName || "Средство измерений",
        sublabel: row.equipmentNumber || undefined,
        responsibleUserId: docResp,
      }));
      return {
        documentId: doc.id,
        documentTitle: doc.title,
        period: { from: toDateKey(doc.dateFrom), to: toDateKey(doc.dateTo) },
        rows: rows.length > 0 ? rows : [{ rowKey: "default", label: "Общая запись", responsibleUserId: docResp }],
      };
    });
  },

  async syncDocument() {
    return EMPTY_SYNC_REPORT;
  },

  async getTaskForm() {
    return buildForm();
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, values }) {
    if (!completed) return false;
    const rowId = rowKey.startsWith("equipment-") ? rowKey.slice(10) : undefined;
    if (!rowId) return false;

    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: { config: true, template: { select: { code: true } } },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE) return false;

    // Защита от пустого doc.config — без `?? {}` `.rows.map` падает с null.
    const rawConfig = (doc.config ?? {}) as Partial<EquipmentCalibrationConfig>;
    const currentConfig: EquipmentCalibrationConfig = {
      ...rawConfig,
      rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
    } as EquipmentCalibrationConfig;
    const nextRows = currentConfig.rows.map((row: CalibrationRow) => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        lastCalibrationDate: typeof values?.lastCalibrationDate === "string" ? values.lastCalibrationDate : row.lastCalibrationDate,
        note: typeof values?.note === "string" ? values.note : row.note,
      };
    });

    const nextConfig: EquipmentCalibrationConfig = { ...currentConfig, rows: nextRows };
    await db.journalDocument.update({ where: { id: documentId }, data: { config: nextConfig } });
    return true;
  },
};
