/**
 * TasksFlow adapter for «График профилактического обслуживания оборудования»
 * (equipment_maintenance).
 *
 * Mapping:
 *   • adapter row  = each equipment row in the document config
 *   • completion   = mark current month's fact cell with "✓"
 *   • schedule     = recurring monthly (1st of month)
 */
import type { TasksFlowIntegration } from "@prisma/client";
import { db } from "@/lib/db";
import {
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  type EquipmentMaintenanceConfig,
  normalizeEquipmentMaintenanceConfig,
} from "@/lib/equipment-maintenance-document";
import { toDateKey } from "@/lib/hygiene-document";
import {
  TasksFlowError,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type JournalSyncReport,
  type TaskSchedule,
} from "./types";

const TEMPLATE_CODE = EQUIPMENT_MAINTENANCE_TEMPLATE_CODE;
const CATEGORY = "WeSetup · ТО оборудования";
const MARK = "✓";

function currentMonthKey(): string {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const map: Record<number, string> = {
    1: "jan",
    2: "feb",
    3: "mar",
    4: "apr",
    5: "may",
    6: "jun",
    7: "jul",
    8: "aug",
    9: "sep",
    10: "oct",
    11: "nov",
    12: "dec",
  };
  return map[month] ?? "jan";
}

export const equipmentMaintenanceAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "ТО оборудования",
    description: "Контроль профилактического обслуживания оборудования",
    iconName: "wrench",
  },

  scheduleForRow(): TaskSchedule {
    return { weekDays: [], monthDay: 1 };
  },

  titleForRow(row): string {
    return `ТО · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Отметьте факт выполнения ТО за текущий месяц.",
    ].join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const docs = await db.journalDocument.findMany({
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
    });
    return docs.map((doc) => {
      const config = normalizeEquipmentMaintenanceConfig(
        doc.config
      ) as EquipmentMaintenanceConfig;
      const adapterDoc: AdapterDocument = {
        documentId: doc.id,
        documentTitle: doc.title,
        period: {
          from: toDateKey(doc.dateFrom),
          to: toDateKey(doc.dateTo),
        },
        rows: (config.rows ?? []).map<AdapterRow>((row) => ({
          rowKey: row.id,
          label: row.equipmentName || "Оборудование",
          sublabel: row.workType || undefined,
          responsibleUserId: config.responsibleEmployeeId ?? null,
        })),
      };
      return adapterDoc;
    });
  },

  async syncDocument({ integration, documentId }): Promise<JournalSyncReport> {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      include: { template: true },
    });
    if (
      !doc ||
      doc.organizationId !== integration.organizationId ||
      doc.template.code !== TEMPLATE_CODE
    ) {
      return EMPTY_SYNC_REPORT;
    }
    if (doc.status === "closed") return EMPTY_SYNC_REPORT;

    const config = normalizeEquipmentMaintenanceConfig(
      doc.config
    ) as EquipmentMaintenanceConfig;
    const rows = config.rows ?? [];

    const userLinks = await db.tasksFlowUserLink.findMany({
      where: { integrationId: integration.id },
      select: { wesetupUserId: true, tasksflowUserId: true },
    });
    const linkByUser = new Map(userLinks.map((l) => [l.wesetupUserId, l]));

    const existingTaskLinks = await db.tasksFlowTaskLink.findMany({
      where: { integrationId: integration.id, journalDocumentId: documentId },
      select: { id: true, rowKey: true, tasksflowTaskId: true },
    });
    const taskLinkByRow = new Map(
      existingTaskLinks.map((tl) => [tl.rowKey, tl])
    );

    const client = tasksflowClientFor(integration);
    const report: JournalSyncReport = {
      created: 0,
      updated: 0,
      deleted: 0,
      skippedNoLink: [],
      errors: [],
    };

    const dateFromIso = toDateKey(doc.dateFrom);
    const dateToIso = toDateKey(doc.dateTo);
    const seen = new Set<string>();

    for (const row of rows) {
      seen.add(row.id);
      const responsibleUserId = config.responsibleEmployeeId;
      let remoteUserId: number | null = null;
      if (responsibleUserId) {
        const link = linkByUser.get(responsibleUserId);
        remoteUserId = link?.tasksflowUserId ?? null;
      }
      if (!remoteUserId) {
        report.skippedNoLink.push(row.id);
        continue;
      }

      const payload = {
        title: `ТО · ${row.equipmentName || "Оборудование"}`,
        workerId: remoteUserId,
        requiresPhoto: false,
        isRecurring: true,
        monthDay: 1,
        category: CATEGORY,
        description: [
          `Журнал: ${doc.title}`,
          `Период: ${dateFromIso} — ${dateToIso}`,
          `Оборудование: ${row.equipmentName || "—"}`,
          `Вид работ: ${row.workType || "—"}`,
          `Тип: ${row.maintenanceType === "A" ? "A (ежемесячно)" : "B (ежегодно)"}`,
        ].join("\n"),
      };

      const existing = taskLinkByRow.get(row.id);
      try {
        if (existing) {
          await client.updateTask(existing.tasksflowTaskId, payload);
          await db.tasksFlowTaskLink.update({
            where: { id: existing.id },
            data: { lastDirection: "push" },
          });
          report.updated += 1;
        } else {
          const created = await client.createTask(payload);
          await db.tasksFlowTaskLink.create({
            data: {
              integrationId: integration.id,
              journalCode: TEMPLATE_CODE,
              journalDocumentId: documentId,
              rowKey: row.id,
              tasksflowTaskId: created.id,
              remoteStatus: created.isCompleted ? "completed" : "active",
              lastDirection: "push",
            },
          });
          report.created += 1;
        }
      } catch (err) {
        const msg =
          err instanceof TasksFlowError
            ? `${err.status} ${err.message}`
            : err instanceof Error
            ? err.message
            : "unknown error";
        report.errors.push({ rowKey: row.id, message: msg });
      }
    }

    for (const tl of existingTaskLinks) {
      if (seen.has(tl.rowKey)) continue;
      try {
        await client.deleteTask(tl.tasksflowTaskId);
      } catch (err) {
        const status = err instanceof TasksFlowError ? err.status : 0;
        if (status !== 404) {
          report.errors.push({
            rowKey: tl.rowKey,
            message: `delete: ${err instanceof Error ? err.message : "unknown"}`,
          });
        }
      }
      await db.tasksFlowTaskLink
        .delete({ where: { id: tl.id } })
        .catch(() => null);
      report.deleted += 1;
    }

    return report;
  },

  async applyRemoteCompletion({ documentId, rowKey, completed, todayKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      include: { template: { select: { code: true } } },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE) return false;

    const config = normalizeEquipmentMaintenanceConfig(
      doc.config
    ) as EquipmentMaintenanceConfig;
    const rowIndex = config.rows.findIndex((r) => r.id === rowKey);
    if (rowIndex < 0) return false;

    const monthKey = currentMonthKey() as keyof typeof config.rows[typeof rowIndex]["fact"];
    const before = config.rows[rowIndex].fact[monthKey] ?? "";
    const next = completed ? MARK : "";
    if (before === next) return false;

    (config.rows[rowIndex].fact as Record<string, string>)[monthKey] = next;
    await db.journalDocument.update({
      where: { id: documentId },
      data: { config },
    });
    return true;
  },

  /**
   * Closing audit gap (_AUDIT.md P1 #1): без getTaskForm сотрудник в TF
   * видел «Форма не требует заполнения». ППР — сложная процедура с
   * чёткими шагами; нужен wizard.
   */
  async getTaskForm({ documentId, rowKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      include: { template: { select: { code: true } } },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE) return null;

    const config = normalizeEquipmentMaintenanceConfig(
      doc.config,
    ) as EquipmentMaintenanceConfig;
    const row = config.rows.find((r) => r.id === rowKey);
    const configuredEquipmentName =
      (row as { title?: string; equipmentName?: string } | undefined)?.title ??
      (row as { title?: string; equipmentName?: string } | undefined)?.equipmentName;
    const hasEquipmentName = typeof configuredEquipmentName === "string" && configuredEquipmentName.trim().length > 0;
    const equipmentName = hasEquipmentName ? configuredEquipmentName : "оборудование";
    const isComplex =
      (row as { maintenanceType?: string; type?: string } | undefined)
        ?.maintenanceType === "B" ||
      (row as { maintenanceType?: string; type?: string } | undefined)?.type === "B";

    const stepsA = [
      "Отключи оборудование от сети",
      "Очисти внешние поверхности",
      "Проверь крепления и соединения",
      "Сделай фото после обслуживания",
    ];
    const stepsB = [
      "Отключи оборудование от сети",
      "Разбери до уровня узлов",
      "Очисти внутренние полости и фильтры",
      "Проверь / замени уплотнители",
      "Смажь подвижные части",
      "Собери и проверь работу",
      "Сделай фото после обслуживания",
    ];
    const steps = isComplex ? stepsB : stepsA;
    const stepKeys = isComplex
      ? ["equipmentMaintenance.disassemble", "equipmentMaintenance.cleanInternal", "equipmentMaintenance.seals", "equipmentMaintenance.lubricate", "equipmentMaintenance.reassemble"]
      : ["equipmentMaintenance.cleanExternal", "equipmentMaintenance.checkConnections"];


    return {
      intro: `Профилактическое обслуживание · ${equipmentName}\nТип ${isComplex ? "B (сложное)" : "A (простое)"}. После каждого шага — «Сделал».`,
      introPresentationKey: hasEquipmentName ? "dynamic.equipmentMaintenance.intro" : "dynamic.equipmentMaintenance.introFallback",
      introPresentationValues: { equipment: equipmentName, type: isComplex ? "B" : "A" },
      fields: [],
      pipeline: steps.map((title, idx) => ({
        id: `step-${idx + 1}`,
        title,
        titlePresentationKey: idx === 0
          ? "dynamic.equipmentMaintenance.disconnect"
          : idx === steps.length - 1
            ? "dynamic.equipmentMaintenance.photo"
            : `dynamic.${stepKeys[idx - 1]}`,
        detailPresentationKey: "dynamic.equipmentMaintenance.stepCount",
        detailPresentationValues: { step: idx + 1, total: steps.length },
        detail: `Шаг ${idx + 1} из ${steps.length}.`,
        photoMode:
          idx === steps.length - 1
            ? ("required" as const)
            : ("optional" as const),
      })),
      submitLabel: "ППР завершён",
      submitPresentationKey: "dynamic.equipmentMaintenance.submit",
    };
  },
};
