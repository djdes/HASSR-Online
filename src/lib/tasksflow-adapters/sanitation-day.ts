/**
 * TasksFlow adapter for «График и учет генеральных уборок»
 * (general_cleaning / sanitation_day).
 *
 * 2026-09-22 — задача на каждую ПЛАНОВУЮ дату, а не ежемесячная
 * повторяющаяся на строку (см. `sanitation-day-tasks.ts`):
 *   • adapter row  = строка графика (помещение) — для QR и выбора строки;
 *     подпись «По плану сегодня» / «Следующая: 25.09»;
 *   • syncDocument = планировщик + TasksFlowOutbox одной транзакцией:
 *     сегодняшние открытые уборки → createTask (разовая задача),
 *     убранные из плана даты → deleteTask, отмеченные руководителем →
 *     completeTask. Прямых вызовов TF API здесь нет (П-12, П-15, П-19);
 *   • completion   = отметка ровно той плановой уборки, днём выполнения
 *     по поясу организации, под блокировкой документа.
 */
import type { Prisma, TasksFlowIntegration } from "@prisma/client";
import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { orgTodayKey } from "@/lib/timezone";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  type SanitationDayConfig,
  applyRoomDirectoryToSanitationConfig,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import { effectiveStepRequirePhoto, parseScopeSteps } from "@/lib/cleaning-document";
import { toDateKey } from "@/lib/hygiene-document";
import { enqueueOutbox, type OutboxClientLike } from "@/lib/tasksflow-outbox-actions";
import { formatDayMonth, formatDayMonthWeekday } from "@/lib/wheel-date";
import {
  applyTaskCompletion,
  nextOpenCleaning,
  parseGcRowKey,
  planGeneralCleaningTasks,
  type GcPlanInput,
  type GcPlannerRoom,
  type GcTaskPlan,
} from "./sanitation-day-tasks";
import {
  EMPTY_SYNC_REPORT,
  type AdapterDocument,
  type AdapterRow,
  type JournalAdapter,
  type JournalSyncReport,
  type TaskSchedule,
} from "./types";

const TEMPLATE_CODE = SANITATION_DAY_TEMPLATE_CODE;

/**
 * 2026-09-04: единый справочник помещений. Строка графика связана с Room
 * (`roomId`): ответственный — первый уборщик помещения, проверяющий —
 * первый проверяющий, фото и шаги формы — из карточки помещения
 * (generalScope / requirePhoto). Без связи — ответственный документа,
 * 8 стандартных шагов, задач по датам нет.
 */
type DirectoryRoomForSanitation = {
  id: string;
  name: string;
  cleanerUserIds: string[];
  verifierUserIds: string[];
  requirePhoto: boolean;
  generalScope: unknown;
  generalScheduleType: string;
  generalDays: number;
  generalMonthDays: unknown;
};

const DIRECTORY_ROOM_SELECT = {
  id: true,
  name: true,
  cleanerUserIds: true,
  verifierUserIds: true,
  requirePhoto: true,
  generalScope: true,
  generalScheduleType: true,
  generalDays: true,
  generalMonthDays: true,
} as const;

/**
 * День месяца для повторяющейся задачи TF (контракт адаптера, общий
 * «Привязать строку»). Задачи по датам графика его не используют.
 * «last» → 28: есть в любом месяце.
 */
function monthDayForRoom(room: DirectoryRoomForSanitation | undefined): number {
  if (!room || room.generalScheduleType !== "monthly") return 1;
  const days = Array.isArray(room.generalMonthDays) ? room.generalMonthDays : [];
  for (const raw of days) {
    if (raw === "last") return 28;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 31) return n;
  }
  return 1;
}

type DocWithMonthDays = AdapterDocument & { _monthDayByRowKey?: Record<string, number> };

function publicBaseUrl(): string {
  return ((process.env.NEXTAUTH_URL ?? "").trim() || "https://wesetup.ru").replace(/\/+$/, "");
}

async function organizationTodayKey(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return orgTodayKey(org?.timezone ?? undefined);
}

export type GeneralCleaningPlan = {
  plan: GcTaskPlan;
  input: GcPlanInput;
  organizationId: string;
};

/**
 * Что нужно сделать в TasksFlow по документу прямо сейчас — без записи.
 * null — документ не наш, закрыт или чужой организации.
 */
export async function buildGeneralCleaningPlan(args: {
  integration: Pick<TasksFlowIntegration, "id" | "organizationId">;
  documentId: string;
  todayKey?: string;
}): Promise<GeneralCleaningPlan | null> {
  const doc = await db.journalDocument.findUnique({
    where: { id: args.documentId },
    select: {
      id: true,
      title: true,
      organizationId: true,
      status: true,
      config: true,
      responsibleUserId: true,
      buildingId: true,
      template: { select: { code: true } },
    },
  });
  if (
    !doc ||
    doc.organizationId !== args.integration.organizationId ||
    doc.template.code !== TEMPLATE_CODE ||
    doc.status === "closed"
  ) {
    return null;
  }

  const [rooms, activeUsers, userLinks, links, todayKey, building] = await Promise.all([
    db.room.findMany({
      where: { building: { organizationId: doc.organizationId } },
      select: DIRECTORY_ROOM_SELECT,
    }),
    db.user.findMany({
      where: { organizationId: doc.organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true },
    }),
    db.tasksFlowUserLink.findMany({
      where: { integrationId: args.integration.id },
      select: { wesetupUserId: true, tasksflowUserId: true },
    }),
    db.tasksFlowTaskLink.findMany({
      where: { integrationId: args.integration.id, journalDocumentId: doc.id },
      select: { id: true, rowKey: true, tasksflowTaskId: true, remoteStatus: true, kind: true },
    }),
    args.todayKey ? Promise.resolve(args.todayKey) : organizationTodayKey(doc.organizationId),
    doc.buildingId
      ? db.building.findUnique({ where: { id: doc.buildingId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const active = new Set(activeUsers.map((user) => user.id));
  const plannerRooms = new Map<string, GcPlannerRoom>(
    rooms.map((room) => [
      room.id,
      {
        cleanerUserIds: room.cleanerUserIds.filter((id) => active.has(id)),
        verifierUserIds: room.verifierUserIds.filter((id) => active.has(id)),
        requirePhoto: room.requirePhoto === true,
      },
    ]),
  );
  const config = applyRoomDirectoryToSanitationConfig(
    normalizeSanitationDayConfig(doc.config),
    rooms,
  );
  const responsibleUserId =
    [config.responsibleEmployeeId, doc.responsibleUserId].find(
      (id): id is string => typeof id === "string" && active.has(id),
    ) ?? null;
  const tfUserIdByWesetupId = new Map<string, number>();
  for (const link of userLinks) {
    if (link.tasksflowUserId !== null) tfUserIdByWesetupId.set(link.wesetupUserId, link.tasksflowUserId);
  }

  const input: GcPlanInput = {
    documentId: doc.id,
    documentTitle: doc.title,
    integrationId: args.integration.id,
    baseUrl: publicBaseUrl(),
    todayKey,
    config,
    rooms: plannerRooms,
    responsibleUserId,
    tfUserIdByWesetupId,
    links,
    buildingName: building?.name ?? null,
  };
  return { plan: planGeneralCleaningTasks(input), input, organizationId: doc.organizationId };
}

/** План → команды outbox одной транзакцией. Ссылки убранных дат удаляются сразу. */
async function commitGeneralCleaningPlan(
  integration: Pick<TasksFlowIntegration, "id">,
  built: GeneralCleaningPlan,
): Promise<void> {
  const { plan, input, organizationId } = built;
  if (plan.create.length === 0 && plan.remove.length === 0 && plan.complete.length === 0) return;
  await db.$transaction(async (tx) => {
    const client = tx as unknown as OutboxClientLike;
    const base = { integrationId: integration.id, organizationId };
    for (const command of plan.create) {
      await enqueueOutbox(
        client,
        {
          ...base,
          idempotencyKey: command.idempotencyKey,
          action: "createTask",
          payload: {
            journalCode: TEMPLATE_CODE,
            documentId: input.documentId,
            rowKey: command.rowKey,
            rowId: command.rowId,
            dateKey: command.dateKey,
            task: command.task,
          },
        },
        { requeue: true },
      );
    }
    for (const command of plan.remove) {
      await enqueueOutbox(client, {
        ...base,
        idempotencyKey: command.idempotencyKey,
        action: "deleteTask",
        payload: {
          taskId: command.taskId,
          journalDocumentId: input.documentId,
          rowKey: command.rowKey,
          reason: "general-cleaning-date-removed",
        },
      });
      // deleteMany: ссылку могли уже удалить параллельно — это не ошибка.
      await tx.tasksFlowTaskLink.deleteMany({ where: { id: command.linkId } });
    }
    for (const command of plan.complete) {
      await enqueueOutbox(client, {
        ...base,
        idempotencyKey: command.idempotencyKey,
        action: "completeTask",
        payload: {
          taskId: command.taskId,
          journalDocumentId: input.documentId,
          rowKey: command.rowKey,
          reason: "general-cleaning-marked-in-journal",
        },
      });
    }
  });
}

export const sanitationDayAdapter: JournalAdapter = {
  meta: {
    templateCode: TEMPLATE_CODE,
    label: "Генеральные уборки",
    description: "Задача в день каждой плановой генеральной уборки помещения",
    iconName: "broom",
  },

  scheduleForRow(row, doc): TaskSchedule {
    const monthDay = (doc as DocWithMonthDays)._monthDayByRowKey?.[row.rowKey] ?? 1;
    return { weekDays: [], monthDay };
  },

  titleForRow(row): string {
    return `Ген. уборка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    return [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
      "Отметьте проведённую генеральную уборку.",
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
    const [directoryRooms, todayKey] = await Promise.all([
      db.room.findMany({
        where: { building: { organizationId } },
        select: DIRECTORY_ROOM_SELECT,
      }),
      organizationTodayKey(organizationId),
    ]);
    const roomById = new Map(directoryRooms.map((r) => [r.id, r]));
    return docs.map((doc) => {
      const config = applyRoomDirectoryToSanitationConfig(
        normalizeSanitationDayConfig(doc.config) as SanitationDayConfig,
        directoryRooms,
      );
      const monthDayByRowKey: Record<string, number> = {};
      const adapterDoc: DocWithMonthDays = {
        documentId: doc.id,
        documentTitle: doc.title,
        period: {
          from: toDateKey(doc.dateFrom),
          to: toDateKey(doc.dateTo),
        },
        rows: (config.rows ?? []).map<AdapterRow>((row) => {
          const room = row.roomId ? roomById.get(row.roomId) : undefined;
          monthDayByRowKey[row.id] = monthDayForRoom(room);
          const next = nextOpenCleaning(row, todayKey);
          const sublabel = next?.planned
            ? next.planned === todayKey
              ? "По плану сегодня"
              : `Следующая: ${formatDayMonth(next.planned)}`
            : undefined;
          return {
            rowKey: row.id,
            label: row.roomName || "Помещение",
            ...(sublabel ? { sublabel } : {}),
            responsibleUserId:
              room?.cleanerUserIds[0] ?? config.responsibleEmployeeId ?? null,
            verifierUserId: room?.verifierUserIds[0] ?? null,
            requiresPhoto: room?.requirePhoto === true,
          };
        }),
      };
      adapterDoc._monthDayByRowKey = monthDayByRowKey;
      return adapterDoc;
    });
  },

  async syncDocument({ integration, documentId }): Promise<JournalSyncReport> {
    const built = await buildGeneralCleaningPlan({ integration, documentId });
    if (!built) return EMPTY_SYNC_REPORT;
    await commitGeneralCleaningPlan(integration, built);
    return {
      created: built.plan.create.length,
      updated: built.plan.complete.length,
      deleted: built.plan.remove.length,
      skippedNoLink: built.plan.skippedNoLink,
      errors: [],
    };
  },

  async applyRemoteCompletion({ documentId, rowKey, completed }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      select: {
        organizationId: true,
        status: true,
        template: { select: { code: true } },
      },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE || doc.status === "closed") return false;

    // День выполнения — по поясу организации, а не UTC вызывающего:
    // до 03:00 МСК UTC-дата ещё вчерашняя.
    const doneKey = await organizationTodayKey(doc.organizationId);
    const changed = await withDocumentConfigLock(documentId, async (locked) => {
      if (locked.status === "closed" || locked.templateCode !== TEMPLATE_CODE) return null;
      const result = applyTaskCompletion(normalizeSanitationDayConfig(locked.config), {
        rowKey,
        doneKey,
        completed,
      });
      if (!result.changed) return null;
      // Прочие ключи конфига (шапка, closedAt) — как были.
      const extras =
        locked.config && typeof locked.config === "object" && !Array.isArray(locked.config)
          ? (locked.config as Record<string, unknown>)
          : {};
      return {
        config: { ...extras, ...result.config } as unknown as Prisma.InputJsonValue,
        result: true,
      };
    });
    return changed === true;
  },

  /**
   * Closing audit gap (см. _AUDIT.md P1 #1): без getTaskForm сотрудник
   * в TF Mini App видел «Форма не требует заполнения». Sanitation day —
   * большой ХАССП-журнал, нужен полноценный wizard.
   *
   * Pipeline: шаги генеральной уборки конкретного помещения. rowKey —
   * строка графика или задача на дату (`gc::<rowId>::<дата>`).
   */
  async getTaskForm({ documentId, rowKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      include: { template: { select: { code: true } } },
    });
    if (!doc || doc.template.code !== TEMPLATE_CODE) return null;

    const directoryRooms = await db.room.findMany({
      where: { building: { organizationId: doc.organizationId } },
      select: DIRECTORY_ROOM_SELECT,
    });
    const config = applyRoomDirectoryToSanitationConfig(
      normalizeSanitationDayConfig(doc.config) as SanitationDayConfig,
      directoryRooms,
    );
    const gc = parseGcRowKey(rowKey);
    const rowId = gc?.rowId ?? rowKey;
    const row = config.rows.find((r) => r.id === rowId);
    const roomName = row?.roomName ?? "помещение";
    const room = row?.roomId ? directoryRooms.find((r) => r.id === row.roomId) : undefined;
    const dateSuffix = gc ? ` · ${formatDayMonthWeekday(gc.dateKey)}` : "";

    // Шаги — из карточки помещения (состав генеральной уборки), если он
    // задан; иначе стандартный список.
    const roomSteps = parseScopeSteps(room?.generalScope);
    if (room && roomSteps.length > 0) {
      return {
        intro: `Генеральная уборка · ${roomName}${dateSuffix}\nСостав из карточки помещения. Выполняйте шаги по порядку.`,
        fields: [],
        pipeline: roomSteps.map((step, idx) => ({
          id: `step-${idx + 1}`,
          title: step.label,
          detail: `Шаг ${idx + 1} из ${roomSteps.length}.`,
          photoMode: effectiveStepRequirePhoto(step, room.requirePhoto)
            ? ("required" as const)
            : ("optional" as const),
        })),
        submitLabel: "Завершить генеральную уборку",
      };
    }

    const steps = [
      "Очистка пола (мойка, дезинфекция)",
      "Очистка стен и плинтусов",
      "Очистка потолка от пыли и паутины",
      "Дезинфекция оборудования",
      "Чистка вентиляционных решёток",
      "Ревизия мебели (стеллажи, столы)",
      "Замена / проверка ловушек грызунов",
      "Финальная проверка и подпись",
    ];

    return {
      intro: `Генеральная уборка · ${roomName}${dateSuffix}\nПолная глубокая уборка с дезинфекцией. Каждый шаг — фотофиксация результата.`,
      fields: [],
      pipeline: steps.map((title, idx) => ({
        id: `step-${idx + 1}`,
        title,
        detail: `Шаг ${idx + 1} из ${steps.length}. После выполнения — фото и «Сделал».`,
        photoMode: "required" as const,
      })),
      submitLabel: "Завершить генеральную уборку",
    };
  },
};
