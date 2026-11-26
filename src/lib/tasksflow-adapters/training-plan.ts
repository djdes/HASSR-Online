/**
 * TasksFlow adapter for «План обучения персонала» (training_plan).
 *
 * Mapping:
 *   • adapter row  = position + topic (rowKey = position-<posId>-topic-<topicId>)
 *   • completion   = mark TrainingCell as required and set date
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  TRAINING_PLAN_TEMPLATE_CODE,
  type TrainingPlanConfig,
  type TrainingPositionRow,
} from "@/lib/training-plan-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type TaskSchedule,
} from "./types";
import type { TaskFormField, TaskFormSchema } from "./task-form";

const TEMPLATE_CODE = TRAINING_PLAN_TEMPLATE_CODE;

function buildForm(): TaskFormSchema {
  const fields: TaskFormField[] = [
    { type: "date", key: "plannedDate", label: "Плановая дата обучения", required: true },
  ];
  return {
    intro: "Установите плановую дату обучения по теме.",
    submitLabel: "Сохранить дату",
    fields,
  };
}

export const trainingPlanAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "План обучения",
    description: "План обучения персонала",
    iconName: "calendar-check",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `План обучения · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [`Журнал: ${doc.documentTitle}`, `Период: ${doc.period.from} — ${doc.period.to}`, "Установите дату обучения."].join("\n");
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
      // Защита от пустого doc.config — `as` не проверяет рантайм, и без
      // `?.` итерация по `config.rows ?? []` падает с null.
      const config = (doc.config ?? {}) as Partial<TrainingPlanConfig>;
      const cfgWithResp = config as unknown as {
        responsibleEmployeeId?: string | null;
      };
      const docResp =
        cfgWithResp?.responsibleEmployeeId ?? doc.responsibleUserId ?? null;
      const rows: AdapterRow[] = [];
      for (const position of config?.rows ?? []) {
        for (const topic of config?.topics ?? []) {
          const cell = position.cells?.[topic.id];
          rows.push({
            rowKey: `position-${position.id}-topic-${topic.id}`,
            label: `${position.positionName} — ${topic.name}`,
            sublabel: cell?.required ? `Дата: ${cell.date || "—"}` : "Не требуется",
            responsibleUserId: docResp,
          });
        }
      }
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
    // Выполнение без значений формы (pull-синхронизация, вебхук TasksFlow,
    // подтверждение задачи с `values: {}`) — записывать нечего: раньше оно
    // сбрасывало поля строки в пустые.
    if (!completed || !values || Object.keys(values).length === 0) return false;
    const match = rowKey.match(/^position-(.+)-topic-(.+)$/);
    if (!match) return false;
    const [, positionId, topicId] = match;

    // Под блокировкой документа: конфиг читается внутри неё, иначе две
    // одновременные отправки (QR, TasksFlow, сайт) теряли одну из записей.
    const written = await withDocumentConfigLock(documentId, async (doc) => {
      if (doc.templateCode !== TEMPLATE_CODE) return null;

      // Защита от пустого doc.config — без guard `.rows.map` падает с null.
      const rawConfig = (doc.config ?? {}) as Partial<TrainingPlanConfig>;
      const currentConfig: TrainingPlanConfig = {
        ...rawConfig,
        rows: Array.isArray(rawConfig.rows) ? rawConfig.rows : [],
        topics: Array.isArray(rawConfig.topics) ? rawConfig.topics : [],
      } as TrainingPlanConfig;
      const nextRows = currentConfig.rows.map((pos: TrainingPositionRow) => {
        if (pos.id !== positionId) return pos;
        return {
          ...pos,
          cells: {
            ...pos.cells,
            [topicId]: { required: true, date: typeof values?.plannedDate === "string" ? values.plannedDate : "" },
          },
        };
      });

      const nextConfig: TrainingPlanConfig = { ...currentConfig, rows: nextRows };
      return { config: nextConfig as unknown as Prisma.InputJsonValue, result: true };
    });
    return written === true;
  },
};
