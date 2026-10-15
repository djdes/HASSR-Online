/**
 * TasksFlow adapter for the «Журнал уборки» (cleaning) journal.
 *
 * Mapping:
 *   • adapter row  = `responsiblePair` in the cleaning document
 *   • completion   = mark today's cell in the matrix with the doc's
 *                    `autoFill.defaultRoomMark` (defaults to "✓")
 *   • schedule     = Mon-Sun by default, Mon-Fri if `skipWeekends`
 *
 * This file is the canonical example of how to write an adapter.
 * Any new journal adapter follows the same shape (register in
 * `index.ts` to expose it to the API + UI).
 */
import type { TasksFlowIntegration } from "@prisma/client";
import { db } from "@/lib/db";
import { findTaskEmployee } from "@/lib/journal-roster-db";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  defaultCleaningRoomPresentationKey,
  type CleaningDocumentConfig,
  effectiveStepRequirePhoto,
  listCleaningRoomCompletions,
  mergeCleaningRoomCompletion,
  normalizeCleaningDocumentConfig,
  parseScopeSteps,
  resolveDocumentController,
  resolveRoomCleaners,
  resolveRoomController,
  resolveRoomControllers,
  type ScopeStep,
} from "@/lib/cleaning-document";
import { applyRoomResponsiblesToConfig } from "@/lib/cleaning-room-responsibles";
import { toDateKey } from "@/lib/hygiene-document";
import { toPrismaJsonValue } from "@/lib/journal-entry-write";
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
import type { TaskFormField } from "./task-form";

const CATEGORY = "WeSetup · Уборка";

export const cleaningAdapter: JournalAdapter = {
  meta: {
    templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
    label: "Журнал уборки",
    description: "Назначение уборщиков на ответственные строки",
    iconName: "spray-can",
  },

  scheduleForRow(_row, doc): TaskSchedule {
    const skip = (doc as AdapterDocument & { _skipWeekends?: boolean })
      ._skipWeekends;
    return { weekDays: skip ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6] };
  },

  titleForRow(row): string {
    return `Уборка · ${row.label}`;
  },

  descriptionForRow(_row, doc): string {
    const sub = (doc as AdapterDocument & { _control?: string })._control;
    const lines = [
      `Журнал: ${doc.documentTitle}`,
      `Период: ${doc.period.from} — ${doc.period.to}`,
    ];
    if (sub) lines.push(`Контроль: ${sub}`);
    return lines.join("\n");
  },

  async listDocumentsForOrg(organizationId): Promise<AdapterDocument[]> {
    const docs = await db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: CLEANING_DOCUMENT_TEMPLATE_CODE },
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

    // Подгружаем комнаты org один раз — нужны для label в rooms-mode +
    // requirePhoto-вычисления. Эффективное room-level requirePhoto =
    // Room.requirePhoto OR любой scope-step имеет explicit requirePhoto=true.
    // Это передаётся в TF как task.requiresPhoto, чтобы worker не мог
    // нажать «Сделал» без фото.
    const allRooms = await db.room.findMany({
      where: { building: { organizationId } },
      select: {
        id: true,
        name: true,
        requirePhoto: true,
        currentScope: true,
        generalScope: true,
        // 2026-09-04: уборщики/проверяющие помещения → эффективный конфиг.
        cleanerUserIds: true,
        verifierUserIds: true,
      },
    });
    const roomNameById = new Map(allRooms.map((r) => [r.id, r.name]));
    const roomRequirePhotoById = new Map(
      allRooms.map((r) => {
        const roomMaster = r.requirePhoto === true;
        const anyStepForcesPhoto =
          parseScopeSteps(r.currentScope).some(
            (s) => s.requirePhoto === true,
          ) ||
          parseScopeSteps(r.generalScope).some(
            (s) => s.requirePhoto === true,
          );
        return [r.id, roomMaster || anyStepForcesPhoto];
      }),
    );
    // И юзеров — для подписи cleaner-а в label.
    const orgUsers = await db.user.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
    });
    const userNameById = new Map(orgUsers.map((u) => [u.id, u.name]));
    const activeUserIds = new Set(orgUsers.map((u) => u.id));

    // 2026-05-09: bulk-assign-today фильтрует rows по matrix today.
    // Если в ячейке `<roomId>::<today>` стоит «/» (не убираться) или
    // пусто — задача на сегодня не нужна, row пропускаем. Это часть
    // realtime sync «matrix → TF» (П-10): matrix — source of truth для
    // содержимого журнала. См. также cleaning-cell-override-sync.ts —
    // он удаляет/обновляет уже-существующие задачи при изменении matrix.
    const todayKey = toDateKey(new Date());

    return docs.map((doc) => {
      // Эффективный конфиг: Room.cleanerUserIds / verifierUserIds
      // подмешиваются после нормализации (см. cleaning-room-responsibles).
      const config = applyRoomResponsiblesToConfig(
        normalizeCleaningDocumentConfig(doc.config) as CleaningDocumentConfig,
        allRooms,
        activeUserIds,
      );
      const adapterDoc: AdapterDocument = {
        documentId: doc.id,
        documentTitle: doc.title,
        period: {
          from: toDateKey(doc.dateFrom),
          to: toDateKey(doc.dateTo),
        },
        rows:
          config.cleaningMode === "rooms"
            ? buildRoomsModeRows(config, roomNameById, userNameById, todayKey, roomRequirePhotoById)
            : (config.responsiblePairs ?? [])
                .filter((pair) => {
                  // pairs-mode: pair.id rowKey не привязан к комнате,
                  // matrix-фильтрация работает только если есть запись
                  // matrix[pair.id][todayKey]. Если её нет — оставляем
                  // (legacy behaviour). Если "/" — skip.
                  const cell = config.matrix?.[pair.id]?.[todayKey];
                  return cell !== "/";
                })
                .map<AdapterRow>((pair) => ({
                  rowKey: pair.id,
                  label: pair.cleaningUserName || pair.cleaningTitle,
                  sublabel: pair.controlUserName
                    ? `Контроль: ${pair.controlUserName}`
                    : pair.controlTitle,
                  responsibleUserId: pair.cleaningUserId,
                })),
      };
      (adapterDoc as AdapterDocument & {
        _skipWeekends?: boolean;
        _control?: string;
        _cleaningMode?: "pairs" | "rooms";
      })._skipWeekends = Boolean(config.skipWeekends);
      (adapterDoc as AdapterDocument & {
        _cleaningMode?: "pairs" | "rooms";
      })._cleaningMode = config.cleaningMode ?? "pairs";
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
      doc.template.code !== CLEANING_DOCUMENT_TEMPLATE_CODE
    ) {
      return EMPTY_SYNC_REPORT;
    }
    if (doc.status === "closed") return EMPTY_SYNC_REPORT;

    const config = normalizeCleaningDocumentConfig(
      doc.config
    ) as CleaningDocumentConfig;

    // Rooms-mode: задачи управляются через bulk-assign-today
    // (per-room rowKey) + syncCleaningCellOverride (per-cell override).
    // syncDocument здесь — pairs-mode legacy. В rooms-mode pairs обычно
    // пустой → нижеследующий цикл «delete tasks not in seen» снёс бы
    // ВСЕ существующие задачи (room::… + cell-override::… + verifier-summary).
    // Юзер видел «после клика по матрице все 3 задачи пропали» — это и
    // была эта каскадная очистка. В rooms-mode ничего не делаем.
    if (config.cleaningMode === "rooms") {
      return EMPTY_SYNC_REPORT;
    }

    const pairs = config.responsiblePairs ?? [];

    const userLinks = await db.tasksFlowUserLink.findMany({
      where: { integrationId: integration.id },
      select: {
        wesetupUserId: true,
        tasksflowUserId: true,
      },
    });
    const linkByUser = new Map(userLinks.map((l) => [l.wesetupUserId, l]));

    const existingTaskLinks = await db.tasksFlowTaskLink.findMany({
      where: {
        integrationId: integration.id,
        journalDocumentId: documentId,
      },
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
    const weekDays = config.skipWeekends
      ? [1, 2, 3, 4, 5]
      : [0, 1, 2, 3, 4, 5, 6];
    const seen = new Set<string>();

    for (const pair of pairs) {
      seen.add(pair.id);
      if (!pair.cleaningUserId) {
        report.skippedNoLink.push(pair.id);
        continue;
      }
      const link = linkByUser.get(pair.cleaningUserId);
      const remoteUserId = link?.tasksflowUserId ?? null;
      if (!remoteUserId) {
        report.skippedNoLink.push(pair.id);
        continue;
      }

      const payload = {
        title: `Уборка · ${pair.cleaningUserName || pair.cleaningTitle}`,
        workerId: remoteUserId,
        requiresPhoto: false,
        isRecurring: true,
        weekDays,
        category: CATEGORY,
        description: [
          `Журнал: ${doc.title}`,
          `Период: ${dateFromIso} — ${dateToIso}`,
          pair.controlUserName
            ? `Контроль: ${pair.controlUserName} (${pair.controlTitle})`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      };

      const existing = taskLinkByRow.get(pair.id);
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
              journalCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
              journalDocumentId: documentId,
              rowKey: pair.id,
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
        report.errors.push({ rowKey: pair.id, message: msg });
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

  async applyRemoteCompletion({
    documentId,
    rowKey,
    completed,
    todayKey,
  }): Promise<boolean> {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      include: { template: true },
    });
    if (!doc || doc.template.code !== CLEANING_DOCUMENT_TEMPLATE_CODE) {
      return false;
    }
    const config = normalizeCleaningDocumentConfig(
      doc.config
    ) as CleaningDocumentConfig;

    // Rooms-mode: rowKey формата `room::{roomId}::cleaner::{cleanerUserId}`.
    // Создаём/обновляем JournalDocumentEntry с информацией кто и когда
    // убрался в этом помещении.
    const parsed = parseRoomsModeRowKey(rowKey);
    if (parsed && config.cleaningMode === "rooms") {
      // Уборщик взят из rowKey внешнего сервиса — только сотрудник
      // организации документа.
      const cleaner = await findTaskEmployee({
        employeeId: parsed.cleanerUserId,
        organizationId: doc.organizationId,
      });
      if (!cleaner) return false;
      return applyRoomsModeCompletion({
        documentId: doc.id,
        organizationId: doc.organizationId,
        roomId: parsed.roomId,
        cleanerUserId: parsed.cleanerUserId,
        dateKey: todayKey,
        completed,
      });
    }

    // Control-digest task: rowKey формата `control::{documentId}::{dateKey}`.
    // Контролёр проверил сводку за день — проставляем
    // controllerCompletedAt всем entries за этот dateKey.
    const ctrl = parseControlRowKey(rowKey);
    if (ctrl && config.cleaningMode === "rooms") {
      // Эффективный конфиг (свои проверяющие помещений из Room) — чтобы
      // сводка конкретного проверяющего штамповала только его помещения.
      const orgRooms = await db.room.findMany({
        where: { building: { organizationId: doc.organizationId } },
        select: { id: true, cleanerUserIds: true, verifierUserIds: true },
      });
      const effective = applyRoomResponsiblesToConfig(config, orgRooms);
      const controllerUserId =
        ctrl.verifierUserId ?? resolveDocumentController(effective);
      // Проверяющий из rowKey (или конфига) — только сотрудник организации.
      if (
        controllerUserId &&
        !(await findTaskEmployee({
          employeeId: controllerUserId,
          organizationId: doc.organizationId,
        }))
      ) {
        return false;
      }
      return applyControlCompletion({
        documentId: doc.id,
        controllerUserId,
        dateKey: ctrl.dateKey,
        completed,
        roomIds: controllerUserId
          ? controllerScopeRoomIds(effective, controllerUserId)
          : undefined,
      });
    }

    // Старая логика — pairs-mode: пишем mark в matrix.
    config.matrix = config.matrix ?? {};
    config.matrix[rowKey] = config.matrix[rowKey] ?? {};
    const before = config.matrix[rowKey][todayKey] ?? "";
    const next = completed
      ? config.autoFill?.defaultRoomMark || "✓"
      : "";
    if (before === next) return false;
    config.matrix[rowKey][todayKey] = next;
    await db.journalDocument.update({
      where: { id: doc.id },
      data: { config },
    });
    return true;
  },

  async getTaskForm({ documentId, rowKey }) {
    const doc = await db.journalDocument.findUnique({
      where: { id: documentId },
      include: { template: true },
    });
    if (!doc || doc.template.code !== CLEANING_DOCUMENT_TEMPLATE_CODE) {
      return null;
    }
    const config = normalizeCleaningDocumentConfig(
      doc.config,
    ) as CleaningDocumentConfig;

    const todayKey = toDateKey(new Date());

    // Override-cell rowKey: cell-override::{roomId}::{dateKey}
    const overrideMatch = /^cell-override::([^:]+)::(\d{4}-\d{2}-\d{2})$/.exec(
      rowKey,
    );
    if (overrideMatch) {
      const [, roomIdRaw, dateKeyRaw] = overrideMatch;
      const cellValue =
        (config.matrix?.[roomIdRaw]?.[dateKeyRaw] as string | undefined) ?? "";
      const cleanType: "current" | "general" =
        cellValue === "G" ? "general" : "current";
      return await buildRoomCleaningFormFromDb({
        config,
        organizationId: doc.organizationId,
        roomId: roomIdRaw,
        cleanType,
        dateKey: dateKeyRaw,
      });
    }

    // Rooms-mode rowKey: room::{roomId}::cleaner::{cleanerId}
    const roomsMatch = /^room::([^:]+)::cleaner::(.+)$/.exec(rowKey);
    if (roomsMatch) {
      const [, roomIdRaw] = roomsMatch;
      const cellValue =
        (config.matrix?.[roomIdRaw]?.[todayKey] as string | undefined) ?? "";
      const cleanType: "current" | "general" =
        cellValue === "G" ? "general" : "current";
      return await buildRoomCleaningFormFromDb({
        config,
        organizationId: doc.organizationId,
        roomId: roomIdRaw,
        cleanType,
        dateKey: todayKey,
      });
    }

    // Pairs-mode (legacy): rowKey = pair.id. Один task на всю смену
    // покрывает все помещения. Pipeline = чек-лист по каждой комнате
    // что нужно сделать сегодня (T или G по матрице).
    const pair = config.responsiblePairs?.find((p) => p.id === rowKey);
    if (pair) {
      return buildPairsCleaningForm({ config, todayKey });
    }

    return null;
  },
};

/**
 * Cleaning unification 2026-05-08: данные о scope/detergent теперь
 * хранятся на Room (DB), не в config.rooms. Этот хелпер сначала
 * ищет Room в БД, fallback на config.rooms[] для legacy-доков.
 */
async function buildRoomCleaningFormFromDb(args: {
  config: CleaningDocumentConfig;
  organizationId: string;
  roomId: string;
  cleanType: "current" | "general";
  dateKey: string;
}): Promise<{
  intro?: string;
  introPresentationKey?: string;
  introPresentationValues?: Record<string, string | number>;
  fields: TaskFormField[];
  pipeline: Array<{
    id: string;
    title: string;
    titlePresentationKey?: string;
    titlePresentationValues?: Record<string, string | number>;
    detail: string;
    detailPresentationKey?: string;
    detailPresentationValues?: Record<string, string | number>;
    photoMode?: "required" | "optional";
  }>;
  submitLabel?: string;
  submitPresentationKey?: string;
} | null> {
  // Source 1: Room (DB) — основной.
  const dbRoom = await db.room.findFirst({
    where: { id: args.roomId, building: { organizationId: args.organizationId } },
    select: {
      name: true,
      detergent: true,
      currentScope: true,
      generalScope: true,
      requirePhoto: true,
    },
  });
  // Source 2: config.rooms[i] — legacy fallback (pairs-mode docs).
  const configRoom = args.config.rooms?.find((r) => r.id === args.roomId);

  const roomName = dbRoom?.name ?? configRoom?.name ?? "(помещение удалено)";
  const detergent = dbRoom?.detergent || configRoom?.detergent || "";

  // Возвращает scope как ScopeStep[] — каждый шаг имеет label + опциональный
  // per-step requirePhoto override. Effective requirePhoto в pipeline ниже
  // считается через effectiveStepRequirePhoto(step, room.requirePhoto).
  function pickScopeSteps(): ScopeStep[] {
    const fromDb =
      args.cleanType === "general" ? dbRoom?.generalScope : dbRoom?.currentScope;
    const dbSteps = parseScopeSteps(fromDb);
    if (dbSteps.length > 0) return dbSteps;
    // Fallback на config.rooms[i] (legacy pairs-mode).
    if (configRoom) {
      const cfgArr =
        args.cleanType === "general"
          ? configRoom.generalScope
          : configRoom.currentScope;
      const cfgSteps = parseScopeSteps(cfgArr);
      if (cfgSteps.length > 0) return cfgSteps;
      // Если нужен general, но в config-room только current — берём current.
      if (args.cleanType === "general") {
        const cur = parseScopeSteps(configRoom.currentScope);
        if (cur.length > 0) return cur;
      }
    }
    return [];
  }

  let scopeSteps = pickScopeSteps();

  // Если в Room generalScope пустой — подмешиваем currentScope (sane default).
  if (
    scopeSteps.length === 0 &&
    args.cleanType === "general" &&
    dbRoom?.currentScope !== undefined
  ) {
    scopeSteps = parseScopeSteps(dbRoom.currentScope);
  }

  // Fallback: пробежимся по reference-table если scope пустой.
  if (scopeSteps.length === 0) {
    const refRow = args.config.referenceTable?.find(
      (r) => r.roomId === args.roomId,
    );
    if (refRow) {
      const arr =
        args.cleanType === "general"
          ? refRow.generalScope
          : refRow.currentScope;
      scopeSteps = parseScopeSteps(arr);
    }
  }

  const cleanLabel =
    args.cleanType === "general" ? "Генеральная уборка" : "Текущая уборка";
  const intro = [
    `${cleanLabel} · ${roomName}`,
    detergent ? `Средство: ${detergent}` : null,
    args.cleanType === "general"
      ? "Полная санобработка: все поверхности, оборудование, дезсредства."
      : "Ежедневная уборка: рабочие поверхности, пол, основное оборудование.",
  ]
    .filter(Boolean)
    .join("\n");
  const introPresentationKey = "dynamic.cleaning.roomIntro";
  const introPresentationValues = { type: args.cleanType, room: roomName, roomKind: "custom", hasDetergent: detergent ? "yes" : "no", detergent };

  const requirePhoto = dbRoom?.requirePhoto === true;

  // 2026-05-09 fix: TF TaskFormFiller рендерит ТОЛЬКО schema.fields[];
  // pipeline-формат был для legacy wesetup-side /task-fill page'а
  // (с redirect'ом, который убрали в TF a0cb75b). Теперь scope steps
  // отдаём как boolean-чекбоксы в fields[] — worker в TF видит чек-лист
  // уборки, а не «WeSetup пока не передал структуру формы» fallback.
  if (scopeSteps.length === 0) {
    const confirmField: TaskFormField = {
      type: "boolean",
      key: "confirmed",
      label: cleanLabel,
      presentationKey: "dynamic.cleaning.kindLabel",
      presentationValues: { type: args.cleanType },
    };
    return {
      intro,
      introPresentationKey,
      introPresentationValues,
      fields: [confirmField],
      pipeline: [
        {
          id: "confirm",
          title: cleanLabel,
          titlePresentationKey: "dynamic.cleaning.kindLabel",
          titlePresentationValues: { type: args.cleanType },
          detail: detergent
            ? `Сделай ${cleanLabel.toLowerCase()} в помещении «${roomName}» с использованием «${detergent}». Подтверди по факту.`
            : `Сделай ${cleanLabel.toLowerCase()} в помещении «${roomName}». Подтверди по факту.`,
          ...(requirePhoto ? { photoMode: "required" as const } : {}),
          detailPresentationKey: "dynamic.cleaning.taskDetail",
          detailPresentationValues: { type: args.cleanType, room: roomName, roomKind: "custom", hasDetergent: detergent ? "yes" : "no", detergent },
        },
      ],
      submitLabel: "Готово",
      submitPresentationKey: "dynamic.cleaning.done",
    };
  }

  const stepFields: TaskFormField[] = scopeSteps.map((step, idx) => {
    const stepRequiresPhoto = effectiveStepRequirePhoto(step, requirePhoto);
    return {
      type: "boolean" as const,
      key: `step_${idx}`,
      label: `${idx + 1}. ${step.label}`,
      presentationKey: "dynamic.cleaning.scopeCheckbox",
      presentationValues: { step: idx + 1, label: step.label },
      ...(stepRequiresPhoto ? { requirePhoto: true } : {}),
    };
  });

  return {
    intro,
    introPresentationKey,
    introPresentationValues,
    fields: stepFields,
    pipeline: scopeSteps.map((step, idx) => {
      const stepRequiresPhoto = effectiveStepRequirePhoto(step, requirePhoto);
      return {
        id: `step-${idx + 1}`,
        title: step.label,
        detail: `Шаг ${idx + 1} из ${scopeSteps.length}. После выполнения нажми «Сделал».`,
        detailPresentationKey: "dynamic.cleaning.scopeStepDetail",
        detailPresentationValues: { step: idx + 1, total: scopeSteps.length },
        ...(stepRequiresPhoto ? { photoMode: "required" as const } : {}),
      };
    }),
    submitLabel: "Готово",
      submitPresentationKey: "dynamic.cleaning.done",
  };
}

function buildPairsCleaningForm(args: {
  config: CleaningDocumentConfig;
  todayKey: string;
}): {
  intro?: string;
  introPresentationKey?: string;
  introPresentationValues?: Record<string, string | number>;
  fields: TaskFormField[];
  pipeline: Array<{
    id: string;
    title: string;
    titlePresentationKey?: string;
    titlePresentationValues?: Record<string, string | number>;
    detail: string;
    detailPresentationKey?: string;
    detailPresentationValues?: Record<string, string | number>;
  }>;
  submitLabel?: string;
  submitPresentationKey?: string;
} | null {
  const rooms = args.config.rooms ?? [];
  if (rooms.length === 0) {
    return {
      introPresentationKey: "dynamic.cleaning.pairsIntro",
      intro: "Уборка по плану журнала. Подтверди по факту.",
      fields: [
        {
          type: "boolean",
          key: "confirmed",
          presentationKey: "dynamic.cleaning.completedLabel",
          label: "Уборка выполнена",
        },
      ],
      pipeline: [
        {
          id: "confirm",
          titlePresentationKey: "dynamic.cleaning.kindLabel",
          titlePresentationValues: { type: "current" },
          title: "Уборка",
          detailPresentationKey: "dynamic.cleaning.pairsTaskDetail",
          detail: "Сделай уборку согласно журналу.",
        },
      ],
    submitPresentationKey: "dynamic.cleaning.done",
      submitLabel: "Готово",
    };
  }

  // Собираем pipeline по тем комнатам, у которых сегодня запланирована
  // уборка (T или G в матрице на сегодня).
  const todayRooms = rooms.filter((room) => {
    const cell = args.config.matrix?.[room.id]?.[args.todayKey];
    return cell === "T" || cell === "G";
  });

  if (todayRooms.length === 0) {
    return {
      introPresentationKey: "dynamic.cleaning.noScheduledIntro",
      intro:
        "Сегодня по плану нет помещений для обязательной уборки. Если нужна — пройди по списку и подтверди.",
      fields: rooms.slice(0, 6).map((room, idx) => ({
        type: "boolean" as const,
        key: `room_${idx}_${room.id}`,
        presentationKey: "dynamic.cleaning.roomLabel",
        presentationValues: { room: room.name, roomKind: defaultCleaningRoomPresentationKey(room) ?? "custom", hasDetergent: room.detergent ? "yes" : "no", detergent: room.detergent ?? "" },
        label: `Уборка · ${room.name}${room.detergent ? ` (средство: ${room.detergent})` : ""}`,
      })),
      pipeline: rooms.slice(0, 6).map((room, idx) => ({
        id: `room-${idx + 1}`,
        titlePresentationKey: "dynamic.cleaning.roomLabel",
        titlePresentationValues: { room: room.name, roomKind: defaultCleaningRoomPresentationKey(room) ?? "custom", hasDetergent: room.detergent ? "yes" : "no", detergent: room.detergent ?? "" },
        title: `Уборка · ${room.name}`,
        detailPresentationKey: "dynamic.cleaning.roomDetail",
        detailPresentationValues: { hasDetergent: room.detergent ? "yes" : "no", detergent: room.detergent ?? "" },
        detail: room.detergent
          ? `Средство: ${room.detergent}.`
          : "Уборка по плану.",
      })),
      submitLabel: "Готово",
      submitPresentationKey: "dynamic.cleaning.done",
    };
  }

  const pipeline = todayRooms.map((room, idx) => {
    const cell = args.config.matrix?.[room.id]?.[args.todayKey];
    // Plain text без emoji — TF Mini App font не всегда рендерит emoji.
    const kind = cell === "G" ? "Генеральная" : "Текущая";
    return {
      id: `room-${idx + 1}-${room.id}`,
      titlePresentationKey: "dynamic.cleaning.kindRoomLabel",
      titlePresentationValues: { type: cell === "G" ? "general" : "current", room: room.name, roomKind: defaultCleaningRoomPresentationKey(room) ?? "custom" },
      title: `${kind} · ${room.name}`,
      detailPresentationKey: "dynamic.cleaning.plannedRoomDetail",
      detailPresentationValues: { type: cell === "G" ? "general" : "current", hasDetergent: room.detergent ? "yes" : "no", detergent: room.detergent ?? "" },
      detail: room.detergent
        ? `Средство: ${room.detergent}. Сделай ${
            cell === "G" ? "генеральную" : "текущую"
          } уборку и подтверди.`
        : `Сделай ${
            cell === "G" ? "генеральную" : "текущую"
          } уборку и подтверди.`,
    };
  });

  const stepFields: TaskFormField[] = todayRooms.map((room, idx) => {
    const cell = args.config.matrix?.[room.id]?.[args.todayKey];
    const kind = cell === "G" ? "Генеральная" : "Текущая";
    return {
      type: "boolean",
      key: `room_${idx}_${room.id}`,
      presentationKey: "dynamic.cleaning.kindRoomLabel",
      presentationValues: { type: cell === "G" ? "general" : "current", room: room.name, roomKind: defaultCleaningRoomPresentationKey(room) ?? "custom" },
      label: `${kind} · ${room.name}${room.detergent ? ` (средство: ${room.detergent})` : ""}`,
    };
  });

  return {
    introPresentationKey: "dynamic.cleaning.todayCount",
    introPresentationValues: { count: pipeline.length },
    intro: `Сегодня по плану уборка в ${pipeline.length} помещ.`,
    fields: stepFields,
    pipeline,
    submitLabel: "Готово",
    submitPresentationKey: "dynamic.cleaning.done",
  };
}

/* =========================================================
 * Rooms-mode helpers
 * ========================================================= */

function buildRoomsModeRows(
  config: CleaningDocumentConfig,
  roomNameById: Map<string, string>,
  userNameById: Map<string, string>,
  todayKey: string,
  roomRequirePhotoById: Map<string, boolean>,
): AdapterRow[] {
  const allRooms = config.selectedRoomIds ?? [];
  const cleaners = config.selectedCleanerUserIds ?? [];
  if (allRooms.length === 0 || cleaners.length === 0) return [];

  // 2026-05-09: matrix-фильтр (П-10 source of truth). Если в ячейке
  // `<roomId>::<todayKey>` стоит «/» (не убираться сегодня) — комнату
  // пропускаем, задача в TF не создаётся. Empty cell (никогда не
  // редактировалась) пускаем — поведение по умолчанию = "уборка нужна",
  // matrix=auto-fill распишет в "T" при создании документа.
  const rooms = allRooms.filter((roomId) => {
    const cell = config.matrix?.[roomId]?.[todayKey];
    return cell !== "/";
  });
  if (rooms.length === 0) return [];

  // Кто убирает комнату решает единый резолвер (cleaning-document.ts):
  // закрепление cleanerByRoomId → пул (race: все, round-robin по индексу
  // в selectedRoomIds). Контролёр — resolveRoomController. Здесь только
  // сборка строк.
  const rows: AdapterRow[] = [];
  for (const roomId of rooms) {
    const roomName = roomNameById.get(roomId) ?? "(удалённая комната)";
    const requiresPhoto = roomRequirePhotoById.get(roomId) === true;
    const roomCleaners = resolveRoomCleaners(config, roomId);
    const pinned = (config.cleanerByRoomId?.[roomId]?.length ?? 0) > 0;
    const verifierUserId = resolveRoomController(config, roomId);
    for (const cleanerId of roomCleaners) {
      const cleanerName =
        userNameById.get(cleanerId) ?? "(удалённый сотрудник)";
      const hint = pinned
        ? roomCleaners.length > 1
          ? " (закреплено за помещением — кто первый)"
          : " (закреплено за помещением)"
        : config.roomsRaceMode === true
          ? " (race — кто первый)"
          : "";
      rows.push({
        rowKey: `room::${roomId}::cleaner::${cleanerId}`,
        label: `Уборка · ${roomName}`,
        sublabel: `Уборщик: ${cleanerName}${hint}`,
        responsibleUserId: cleanerId,
        verifierUserId,
        requiresPhoto,
      });
    }
  }
  return rows;
}

function parseRoomsModeRowKey(
  rowKey: string
): { roomId: string; cleanerUserId: string } | null {
  // Формат: `room::{roomId}::cleaner::{cleanerUserId}`
  const m = /^room::([^:]+)::cleaner::([^:]+)$/.exec(rowKey);
  if (!m) return null;
  return { roomId: m[1], cleanerUserId: m[2] };
}

export function parseControlRowKey(
  rowKey: string
): { documentId: string; dateKey: string; verifierUserId: string | null } | null {
  // Формат: `control::{documentId}::{dateKey}` — контролёр документа
  // (legacy-ключ, идемпотентность старых задач не ломаем), либо
  // `control::{documentId}::{dateKey}::{verifierUserId}` — свой
  // проверяющий помещений (2026-09-04, сводка каждому по его комнатам).
  const m = /^control::([^:]+)::([0-9-]+)(?:::([^:]+))?$/.exec(rowKey);
  if (!m) return null;
  return { documentId: m[1], dateKey: m[2], verifierUserId: m[3] ?? null };
}

export function buildControlRowKey(
  documentId: string,
  dateKey: string,
  verifierUserId?: string | null,
): string {
  return verifierUserId
    ? `control::${documentId}::${dateKey}::${verifierUserId}`
    : `control::${documentId}::${dateKey}`;
}

/**
 * Помещения, которые проверяет `verifierUserId` в этом документе:
 * те, где он в resolveRoomControllers. Возвращает undefined, когда ни у
 * одного помещения нет своих проверяющих — тогда контролёр документа
 * отвечает за всё (legacy-поведение без scope).
 */
export function controllerScopeRoomIds(
  config: Pick<
    CleaningDocumentConfig,
    "selectedRoomIds" | "verifierByRoomId" | "controlUserId" | "controlResponsibles"
  >,
  verifierUserId: string,
): Set<string> | undefined {
  const hasZoneVerifiers = Object.values(config.verifierByRoomId ?? {}).some(
    (ids) => Array.isArray(ids) && ids.length > 0,
  );
  if (!hasZoneVerifiers) return undefined;
  const scope = new Set<string>();
  for (const roomId of config.selectedRoomIds ?? []) {
    if (resolveRoomControllers(config, roomId).includes(verifierUserId)) {
      scope.add(roomId);
    }
  }
  return scope;
}

async function applyControlCompletion(args: {
  documentId: string;
  controllerUserId: string | null;
  dateKey: string;
  completed: boolean;
  /** Optional zone scope (per-room controllers). Absent = every room. */
  roomIds?: Set<string>;
}): Promise<boolean> {
  if (!args.completed || !args.controllerUserId) return false;
  const date = new Date(`${args.dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;

  // Находим все cleaning_room entries за эту дату, проставляем
  // controllerCompletedAt + controllerUserId.
  const entries = await db.journalDocumentEntry.findMany({
    where: {
      documentId: args.documentId,
      date,
      data: { path: ["kind"], equals: "cleaning_room" },
    },
    select: { id: true, data: true },
  });
  if (entries.length === 0) return false;

  const stamp = new Date().toISOString();
  let touched = false;
  for (const e of entries) {
    const prevData =
      e.data && typeof e.data === "object" && !Array.isArray(e.data)
        ? (e.data as Record<string, unknown>)
        : {};
    const completions = listCleaningRoomCompletions(prevData);
    const rooms: Record<string, Record<string, unknown>> = {};
    let changed = false;
    for (const c of completions) {
      // Phase 2 hook: `roomIds` limits the stamp to this controller's zones.
      const inScope = !args.roomIds || args.roomIds.has(c.roomId);
      const stamped = Boolean(c.controllerCompletedAt);
      rooms[c.roomId] = {
        completedAt: c.completedAt,
        ...(c.controllerUserId ? { controllerUserId: c.controllerUserId } : {}),
        ...(c.controllerCompletedAt
          ? { controllerCompletedAt: c.controllerCompletedAt }
          : {}),
      };
      if (inScope && !stamped) {
        rooms[c.roomId].controllerUserId = args.controllerUserId;
        rooms[c.roomId].controllerCompletedAt = stamp;
        changed = true;
      }
    }
    if (!changed) continue;
    touched = true;
    await db.journalDocumentEntry.update({
      where: { id: e.id },
      data: {
        data: toPrismaJsonValue({
          ...prevData,
          // Legacy top-level stamp stays for old readers.
          controllerUserId: prevData.controllerUserId ?? args.controllerUserId,
          controllerCompletedAt: prevData.controllerCompletedAt ?? stamp,
          rooms,
        }),
      },
    });
  }
  return touched;
}

/**
 * Race-resolution + persist завершения уборки помещения.
 *
 * Логика:
 *   - Если у этого documentId+roomId+dateKey уже есть завершённая
 *     запись (другой уборщик был первым) — возвращаем false без
 *     перезаписи. Race-победитель не меняется.
 *   - Иначе создаём JournalDocumentEntry с
 *     data: { kind, roomId, dateKey, cleanerUserId, completedAt }.
 *
 * Контролёр получит сводную задачу cron'ом cleaning-control-digest
 * (см. /api/cron/cleaning-control-digest) и его complete пометит
 * controllerCompletedAt всем сегодняшним entries дня.
 */
async function applyRoomsModeCompletion(args: {
  documentId: string;
  organizationId: string;
  roomId: string;
  cleanerUserId: string;
  dateKey: string;
  completed: boolean;
}): Promise<boolean> {
  if (!args.completed) {
    // Реоткрытие — не трогаем существующую запись (другой уборщик мог
    // её закрыть). Если хотим reopen — это явное действие, пока not implemented.
    return false;
  }

  // dateKey "YYYY-MM-DD" → Date (UTC midnight). Совпадает с тем как
  // hygiene-document.toDateKey работает.
  const date = new Date(`${args.dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;

  // Все completion-entries за (document, date): их не больше, чем
  // уборщиков, поэтому race-check делаем в JS через
  // listCleaningRoomCompletions (new `rooms` map + legacy roomId).
  const dayEntries = await db.journalDocumentEntry.findMany({
    where: {
      documentId: args.documentId,
      date,
      data: { path: ["kind"], equals: "cleaning_room" },
    },
    select: { employeeId: true, data: true },
  });
  const takenByOther = dayEntries.some(
    (e) =>
      e.employeeId !== args.cleanerUserId &&
      listCleaningRoomCompletions(e.data).some((c) => c.roomId === args.roomId),
  );
  if (takenByOther) {
    // Race lost — другой cleaner был первым. TF-task pipeline всё равно
    // пометит remote как completed, но новую entry не создаём.
    return false;
  }

  // Одна entry на (documentId, cleaner, date): все зоны дня сливаются в
  // `data.rooms`, legacy `roomId` указывает на последнюю. Повторный
  // complete той же зоны — idempotent overwrite completedAt.
  const own = dayEntries.find((e) => e.employeeId === args.cleanerUserId);
  const merged = mergeCleaningRoomCompletion(own?.data, {
    roomId: args.roomId,
    cleanerUserId: args.cleanerUserId,
    dateKey: args.dateKey,
    completedAt: new Date().toISOString(),
  });
  await db.journalDocumentEntry.upsert({
    where: {
      documentId_employeeId_date: {
        documentId: args.documentId,
        employeeId: args.cleanerUserId,
        date,
      },
    },
    create: {
      documentId: args.documentId,
      employeeId: args.cleanerUserId,
      date,
      data: toPrismaJsonValue(merged),
    },
    update: { data: toPrismaJsonValue(merged) },
  });
  return true;
}
