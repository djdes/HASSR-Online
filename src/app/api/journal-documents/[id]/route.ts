import { NextResponse } from "next/server";
import { isBrakerageJournalCode, mergeBrakerageConfig, parseKnownRowIds } from "@/lib/brakerage-row-merge";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { isCommissionJournalCode, unsignedRows } from "@/lib/brakerage-commission";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
} from "@/lib/climate-document";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  normalizeColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";
import {
  TRAINING_PLAN_TEMPLATE_CODE,
  normalizeTrainingPlanConfig,
} from "@/lib/training-plan-document";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  validateCleaningDocumentConfig,
  type CleaningDocumentConfig,
} from "@/lib/cleaning-document";
import {
  normalizeJournalDocumentStaffState,
  pickChangedConfigResponsible,
  normalizeJournalStaffBoundConfig,
} from "@/lib/journal-staff-binding";
import {
  CONTROL_PERIODICITY_CONFIG_KEY,
  sanitizeControlPeriodicity,
} from "@/lib/control-periodicity";
import { applyRoomResponsiblesToConfig } from "@/lib/cleaning-room-responsibles";
import {
  carryDocumentHeaderFields,
  withoutDocumentHeaderFields,
} from "@/lib/journal-header-carry";
import { HEADER_TITLE_CONFIG_KEY, sanitizeHeaderTitle } from "@/lib/journal-header-title";
import { ORG_HEADER_NAME_CONFIG_KEY, sanitizeOrgJournalName } from "@/lib/org-journal-name";
import { syncDocumentToTasksFlow } from "@/lib/tasksflow-sync";
import { isJournalSupported } from "@/lib/tasksflow-adapters";
import { syncTodayMatrixChanges } from "@/lib/cleaning-cell-override-sync";
import { isManagementRole } from "@/lib/user-roles";
import { canWriteJournal, hasJournalAccess } from "@/lib/journal-acl";
import {
  ORG_ROSTER_WHERE,
  ORG_SIGNER_WHERE,
  RESPONSIBLE_NOT_IN_ORG_ERROR,
  resolveResponsibleChoice,
} from "@/lib/journal-roster";
import { findOrgUser } from "@/lib/journal-roster-db";
import { orgTodayKey } from "@/lib/timezone";
import { Prisma, TasksFlowOutboxStatus } from "@prisma/client";
import { buildDocumentTaskDeleteCommands } from "@/lib/journal-document-tasks-cleanup";
import { mergeSanitationTaskMarks } from "@/lib/general-cleaning-merge";

/**
 * Журналы, которые ведут собственную дату окончания в шапке бланка
 * (`config.finishedAt`). Закрытие документа проставляет её, только если
 * человек не заполнил дату сам.
 */
const FINISHED_AT_JOURNAL_CODES = new Set([
  "accident_journal",
  "complaint_register",
  "daily_samples",
  "vitaminization",
  "ration_control",
  "transport_temperature",
  "tableware_breakage",
  "pool_water_control",
  "fryer_oil",
  "intensive_cooling",
  "perishable_rejection",
]);

function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const doc = await db.journalDocument.findUnique({
    where: { id },
    include: {
      template: true,
      entries: {
        orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      },
    },
  });

  if (!doc || doc.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // ACL: документы могут содержать PII (med_books — мед-книжки,
  // health_check — допуск к работе, …). Без hasJournalAccess любой
  // staff org-и читал содержимое любого документа.
  const aclActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (doc.template?.code && !(await hasJournalAccess(aclActor, doc.template.code))) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // Load org employees for the grid rows
  const employees = await db.user.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      isActive: true,
    },
    select: { id: true, name: true, role: true, positionTitle: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ document: doc, employees });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const doc = await db.journalDocument.findUnique({ where: { id } });
  if (!doc || doc.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // Оборванный или пустой запрос — это ошибка клиента, а не 500 сервера.
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  const needsTemplateLookup =
    doc.templateId &&
    (body.config !== undefined ||
      body.responsibleTitle !== undefined ||
      body.responsibleUserId !== undefined);
  // Смена статуса тоже должна знать код журнала — по нему решается,
  // заполнять ли `config.finishedAt` при закрытии.
  const needsTemplateForStatus = Boolean(doc.templateId) && body.status !== undefined;
  const template = needsTemplateLookup || needsTemplateForStatus
    ? await db.journalTemplate.findUnique({
        where: { id: doc.templateId },
        select: { code: true },
      })
    : null;

  // ПОЧЕМУ: у ППР, поверки, поломок, интенсивного охлаждения и перечня
  // стекла ВСЕ записи журнала лежат в `config`. При management-only PATCH
  // рядовой сотрудник с доступом к журналу не мог внести ни одной записи.
  // Поэтому PATCH, меняющий ТОЛЬКО `config` активного документа, разрешён
  // тому, у кого есть право записи в этот журнал. Любое другое поле
  // (status, title, dateFrom/dateTo, responsibleUserId, шапка…) остаётся
  // management-only — как раньше.
  if (!isManagementRole(session.user.role)) {
    const touchedKeys = Object.keys(body ?? {}).filter(
      (key) => body[key] !== undefined
    );
    const configOnly =
      touchedKeys.length > 0 && touchedKeys.every((key) => key === "config");
    const canEditConfig =
      configOnly &&
      doc.status === "active" &&
      Boolean(template?.code) &&
      (await canWriteJournal(
        {
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        },
        template!.code
      ));
    if (!canEditConfig) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }
  }
  // Ростер документа — живые сотрудники этой организации без ROOT: только
  // их можно поставить ответственным и подставить в поля бланка.
  const allUsers =
    needsTemplateLookup
      ? await db.user.findMany({
          where: {
            organizationId: getActiveOrgId(session),
            // Бракераж: в сверку сотрудников конфига входит и сторонняя
            // комиссия, иначе привязка её членов обнулялась бы при каждом
            // сохранении (normalizeJournalEntryStaffData).
            ...(isCommissionJournalCode(template?.code) ? ORG_SIGNER_WHERE : ORG_ROSTER_WHERE),
          },
          select: {
            id: true,
            name: true,
            role: true,
            positionTitle: true,
            // Должность из справочника: без неё перештамповка писала в строки
            // устаревший positionTitle или лейбл роли.
            jobPosition: { select: { name: true } },
          },
          orderBy: [{ role: "asc" }, { name: "asc" }],
        })
      : [];

  // Выбор ответственного — только если прислали ДРУГОГО человека. Часть
  // клиентов (уборка, контроль стекла) шлёт текущего ответственного при
  // каждом сохранении: это не выбор, и уволенный ответственный не должен
  // блокировать сохранение ячеек.
  const bodyResponsibleId =
    typeof body.responsibleUserId === "string" ? body.responsibleUserId.trim() : "";
  const responsibleChosen =
    body.responsibleUserId !== undefined && bodyResponsibleId !== (doc.responsibleUserId ?? "");

  // Явно выбранный ответственный обязан быть сотрудником организации.
  // Пустая строка / null — «снять ответственного», это законно.
  if (responsibleChosen) {
    const choice = resolveResponsibleChoice({
      bodyUserId: body.responsibleUserId,
      orgUserIds: new Set(allUsers.map((user) => user.id)),
    });
    if ("error" in choice) {
      return NextResponse.json(RESPONSIBLE_NOT_IN_ORG_ERROR, { status: 400 });
    }
  }

  if (
    doc.status === "closed" &&
    [
      "title",
      "autoFill",
      "responsibleTitle",
      "responsibleUserId",
      "config",
      "controlPeriodicity",
      "headerOrgName",
      "headerTitle",
      "dateFrom",
      "dateTo",
    ].some((key) => body[key] !== undefined)
  ) {
    return NextResponse.json(
      { error: "Закрытый документ нельзя редактировать до перевода в активные" },
      { status: 400 }
    );
  }

  if (body.status !== undefined && !["active", "closed"].includes(body.status)) {
    return NextResponse.json({ error: "Некорректный статус документа" }, { status: 400 });
  }

  let nextDateFrom = body.dateFrom !== undefined ? new Date(body.dateFrom) : new Date(doc.dateFrom);
  let nextDateTo = body.dateTo !== undefined ? new Date(body.dateTo) : new Date(doc.dateTo);

  if (!isValidDate(nextDateFrom) || !isValidDate(nextDateTo)) {
    return NextResponse.json({ error: "Некорректный период документа" }, { status: 400 });
  }

  if (nextDateFrom > nextDateTo) {
    return NextResponse.json(
      { error: "Дата начала не может быть позже даты окончания" },
      { status: 400 }
    );
  }

  // Защита от случайного сжатия документа.
  //
  // Несколько UI-клиентов (accident-document-client, complaint-documents-
  // client, ppe-issuance-document-client, intensive-cooling-document-client,
  // equipment-cleaning-documents-client) при сохранении строки/конфига
  // отправляют `dateFrom` и `dateTo`, заданные одинаковыми (= одна дата).
  // Это правильно только при создании single-day мероприятия. Но если
  // существующий документ был многомесячным/годовым/perpetual — такой
  // PATCH сжимает его в один день, после чего:
  //   1. На /journals snippet `dateFrom <= today AND dateTo >= today`
  //      перестаёт его находить → checkbox «Создать документы»
  //      возвращается, хотя документ есть.
  //   2. POST /api/integrations/tasksflow/bulk-assign-today тоже не
  //      находит и создаёт ВТОРОЙ документ для того же шаблона.
  // Полностью клиентский фикс невозможен — слишком много мест. Поэтому
  // здесь, на сервере, отказываемся СОКРАЩАТЬ период, если каллер не
  // передал явный `shrinkPeriod: true`. Расширение периода и обновление
  // dateFrom не блокируются — они никогда не приводят к этому багу.
  const oldFrom = new Date(doc.dateFrom).getTime();
  const oldTo = new Date(doc.dateTo).getTime();
  const newFrom = nextDateFrom.getTime();
  const newTo = nextDateTo.getTime();
  const oldSpansMultipleDays = oldTo - oldFrom > 24 * 60 * 60 * 1000;
  const newWouldBeSingleDay = newTo - newFrom < 24 * 60 * 60 * 1000;
  const shrinkRequested = body.shrinkPeriod === true;
  if (oldSpansMultipleDays && newWouldBeSingleDay && !shrinkRequested) {
    nextDateFrom = new Date(doc.dateFrom);
    nextDateTo = new Date(doc.dateTo);
  }

  if (
    template?.code &&
    (body.config !== undefined ||
      body.responsibleTitle !== undefined ||
      body.responsibleUserId !== undefined)
  ) {
    const baseConfig =
      body.config !== undefined
        ? template.code === CLIMATE_DOCUMENT_TEMPLATE_CODE
          ? normalizeClimateDocumentConfig(body.config)
          : template.code === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE
          ? normalizeColdEquipmentDocumentConfig(body.config)
          : template.code === TRAINING_PLAN_TEMPLATE_CODE
          ? normalizeJournalStaffBoundConfig(
              template.code,
              normalizeTrainingPlanConfig(body.config),
              allUsers
            )
          : template.code === SANITATION_DAY_TEMPLATE_CODE
          ? (() => {
              const normalized = normalizeJournalStaffBoundConfig(
                template.code,
                normalizeSanitationDayConfig(body.config),
                allUsers
              ) as Record<string, unknown>;
              return {
                ...normalized,
                year:
                  typeof normalized.year === "number"
                    ? normalized.year
                    : nextDateFrom.getUTCFullYear(),
                documentDate:
                  typeof normalized.documentDate === "string" &&
                  normalized.documentDate
                    ? normalized.documentDate
                    : nextDateFrom.toISOString().slice(0, 10),
              };
            })()
          : normalizeJournalStaffBoundConfig(template.code, body.config, allUsers)
        : doc.config;

    const normalizedDocumentState = normalizeJournalDocumentStaffState(
      template.code,
      {
        config: baseConfig,
        responsibleUserId:
          body.responsibleUserId !== undefined
            ? body.responsibleUserId
            : doc.responsibleUserId,
        responsibleTitle:
          body.responsibleTitle !== undefined
            ? body.responsibleTitle
            : doc.responsibleTitle,
      },
      allUsers,
      // Раньше при каждом сохранении ячейки, если ответственный документа
      // не находился в ростере, сюда подставлялся «кто-нибудь» (владелец),
      // и он молча становился ответственным журнала.
      { allowFallbackUser: false }
    );

    if (body.config !== undefined) {
      // Server-side validation для cleaning rooms-mode — отсекаем
      // невалидные конфиги ДО save'а чтобы юзер увидел понятную ошибку,
      // а не silent-fail в bulk-assign.
      if (template.code === CLEANING_DOCUMENT_TEMPLATE_CODE) {
        try {
          // Валидируем ЭФФЕКТИВНЫЙ конфиг: уборщики могут быть назначены
          // помещениям (Room.cleanerUserIds), а не выбраны в пуле
          // документа — такой документ валиден.
          const rawCleaningConfig =
            normalizedDocumentState.config as CleaningDocumentConfig;
          const roomsForValidation = await db.room.findMany({
            where: {
              id: { in: rawCleaningConfig.selectedRoomIds ?? [] },
              building: { organizationId: doc.organizationId },
            },
            select: { id: true, cleanerUserIds: true, verifierUserIds: true },
          });
          validateCleaningDocumentConfig(
            applyRoomResponsiblesToConfig(rawCleaningConfig, roomsForValidation),
          );
        } catch (err) {
          return NextResponse.json(
            {
              error:
                err instanceof Error ? err.message : "Невалидная конфигурация",
            },
            { status: 400 },
          );
        }
      }
      data.config = normalizedDocumentState.config;
    }

    // Ответственного меняем, только когда его выбрали этим запросом:
    //   • пришёл `responsibleUserId` (выбор в настройках документа) —
    //     пишем то, что выбрали (id уже проверен выше);
    //   • ответственный выбран ВНУТРИ конфига и отличается от прежнего
    //     конфига: диалоги настроек реестров пишут выбор в
    //     `defaultResponsibleUserId` / `responsibleEmployeeId` /
    //     `approveEmployeeId` и шлют только `config`.
    // Сохранение строк и ячеек присылает прежний выбор в конфиге — такой
    // запрос ответственного не трогает, даже если у документа его нет.
    const configChoice =
      body.responsibleUserId === undefined && body.config !== undefined
        ? pickChangedConfigResponsible({
            templateCode: template.code,
            previousConfig: doc.config,
            nextConfig: normalizedDocumentState.config,
            users: allUsers,
          })
        : null;
    if (responsibleChosen) {
      data.responsibleUserId = normalizedDocumentState.responsibleUserId;
      data.responsibleTitle = normalizedDocumentState.responsibleTitle;
    } else if (configChoice && configChoice.responsibleUserId !== doc.responsibleUserId) {
      data.responsibleUserId = configChoice.responsibleUserId;
      data.responsibleTitle = configChoice.responsibleTitle;
    } else if (body.responsibleTitle !== undefined) {
      data.responsibleTitle = normalizedDocumentState.responsibleTitle;
    }

    // Новый ответственный — в шапке его должность из карточки сотрудника,
    // как при создании документа, а не название роли («Шеф-повар»).
    if (
      typeof data.responsibleUserId === "string" &&
      data.responsibleUserId &&
      data.responsibleUserId !== doc.responsibleUserId
    ) {
      const chosen = await findOrgUser(getActiveOrgId(session), data.responsibleUserId);
      const positionName = chosen?.jobPositionName || chosen?.positionTitle || "";
      if (positionName) data.responsibleTitle = positionName;
    }
  }

  if (body.title !== undefined) data.title = body.title;
  // Бракераж готовой продукции с комиссией (скоропорт — без комиссии): без подписи хотя бы одного члена комиссии
  // строку не закрыть, а значит и журнал не закончить (владелец, 2026-09-21).
  if (body.status === "closed" && doc.status !== "closed" && isCommissionJournalCode(template?.code)) {
    const pending = unsignedRows(
      (doc.config && typeof doc.config === "object" ? doc.config : {}) as {
        commissionMembers?: unknown[];
        rows?: Record<string, unknown>[];
      }
    );
    if (pending.length > 0) {
      return NextResponse.json(
        {
          error: `Нельзя закончить журнал: ${pending.length} ${pending.length === 1 ? "строка ждёт" : "строк ждут"} подписи комиссии`,
          code: "unsigned-rows",
          unsigned: pending.slice(0, 20).map((row) => String(row.productName || row.productionDateTime || "без названия")),
        },
        { status: 409 }
      );
    }
  }
  if (body.status !== undefined) data.status = body.status;
  if (body.autoFill !== undefined) data.autoFill = body.autoFill;
  if (body.config !== undefined && data.config === undefined) data.config = body.config;

  // Поля бумажной шапки — периодичность контроля, название организации и
  // название документа «только в этом документе» — живут в config, но
  // принадлежат шапке, а не журналу:
  //
  //   1. копию из присланного `config` не берём: клиент держит конфиг,
  //      загруженный до правки шапки, и вернул бы старый текст; прежние
  //      значения переносятся из документа (тот же перенос страхует все
  //      остальные записи конфига — хук в src/lib/db.ts);
  //   2. меняют их только явные поля тела: `controlPeriodicity` (модалка
  //      «Настройки журнала», шапка), `headerOrgName`, `headerTitle`
  //      (шапка документа). Пустая строка — «убрать»: у периодичности это
  //      скрытая строка шапки, у названий — возврат к общему.
  //
  // Обратная совместимость: если ключа нет ни там, ни там — ничего не пишем,
  // на чтении `readControlPeriodicity()` вернёт дефолт шаблона.
  {
    const previousConfig =
      doc.config && typeof doc.config === "object" && !Array.isArray(doc.config)
        ? (doc.config as Record<string, unknown>)
        : null;

    if (data.config !== undefined) {
      data.config = carryDocumentHeaderFields(
        previousConfig,
        withoutDocumentHeaderFields(data.config)
      );
    }

    const headerEdits: Record<string, string> = {};
    if (body.controlPeriodicity !== undefined) {
      headerEdits[CONTROL_PERIODICITY_CONFIG_KEY] = sanitizeControlPeriodicity(
        body.controlPeriodicity
      );
    }
    if (body.headerOrgName !== undefined) {
      headerEdits[ORG_HEADER_NAME_CONFIG_KEY] = sanitizeOrgJournalName(body.headerOrgName);
    }
    if (body.headerTitle !== undefined) {
      headerEdits[HEADER_TITLE_CONFIG_KEY] = sanitizeHeaderTitle(body.headerTitle);
    }
    if (Object.keys(headerEdits).length > 0) {
      const baseConfig =
        data.config !== undefined &&
        data.config &&
        typeof data.config === "object" &&
        !Array.isArray(data.config)
          ? (data.config as Record<string, unknown>)
          : previousConfig ?? {};
      data.config = { ...baseConfig, ...headerEdits };
    }
  }

  // Дата закрытия документа. ПОЧЕМУ: её нигде не хранили, и шапка
  // «Окончен» печатала то `dateTo`, то `new Date()` — при каждой
  // перепечатке новая дата. Схему БД не трогаем: пишем в `config.closedAt`
  // день по поясу организации.
  if (body.status !== undefined && body.status !== doc.status) {
    const org = await db.organization.findUnique({
      where: { id: doc.organizationId },
      select: { timezone: true },
    });
    const closedDayKey = orgTodayKey(org?.timezone ?? undefined);
    const baseConfig =
      data.config !== undefined &&
      data.config &&
      typeof data.config === "object" &&
      !Array.isArray(data.config)
        ? ({ ...(data.config as Record<string, unknown>) } as Record<string, unknown>)
        : doc.config && typeof doc.config === "object" && !Array.isArray(doc.config)
          ? ({ ...(doc.config as Record<string, unknown>) } as Record<string, unknown>)
          : {};
    if (body.status === "closed") {
      baseConfig.closedAt = closedDayKey;
      // У аварий, претензий, фритюра и интенсивного охлаждения своя дата
      // окончания в шапке. Уже проставленную не трогаем — её ставил человек.
      if (
        template?.code &&
        FINISHED_AT_JOURNAL_CODES.has(template.code) &&
        !(
          typeof baseConfig.finishedAt === "string" &&
          baseConfig.finishedAt.trim() !== ""
        )
      ) {
        baseConfig.finishedAt = closedDayKey;
      }
    } else {
      delete baseConfig.closedAt;
    }
    data.config = baseConfig;
  }

  if (body.dateFrom !== undefined) data.dateFrom = nextDateFrom;
  if (body.dateTo !== undefined) data.dateTo = nextDateTo;

  // Бракеражи: строки, добавленные по QR и подписанные комиссией, пока
  // страница была открыта, не затираются — слияние под блокировкой
  // документа (см. brakerage-row-merge.ts).
  const updated =
    isBrakerageJournalCode(template?.code) && data.config !== undefined
      ? await withDocumentConfigLock(id, async (locked) => ({
          config: mergeBrakerageConfig({
            incoming: data.config,
            current: locked.config,
            knownRowIds: parseKnownRowIds((body as { knownRowIds?: unknown }).knownRowIds),
          }) as Prisma.InputJsonValue,
          data: { ...data, config: undefined },
          result: true,
        })).then(() => db.journalDocument.findUniqueOrThrow({ where: { id } }))
      : template?.code === SANITATION_DAY_TEMPLATE_CODE && data.config !== undefined
      ? // График генуборок: отметки из задач TasksFlow / QR, пришедшие,
        // пока страница была открыта, не затираются — слияние под той же
        // блокировкой документа, что и у адаптера (general-cleaning-merge.ts).
        await withDocumentConfigLock(id, async (locked) => ({
          config: mergeSanitationTaskMarks({
            incoming: data.config,
            current: locked.config,
          }) as unknown as Prisma.InputJsonValue,
          data: { ...data, config: undefined },
          result: true,
        })).then(() => db.journalDocument.findUniqueOrThrow({ where: { id } }))
      : await db.journalDocument.update({ where: { id }, data });

  // Fire-and-forget TasksFlow sync for journals whose adapter is
  // registered (see src/lib/tasksflow-adapters/index.ts). Sync runs
  // after the local save completes, so a TasksFlow outage never blocks
  // the user's edit. Errors are surfaced through the integration log
  // (see lastSyncAt + the report). We don't await the result on the
  // response path because the journal UI auto-refreshes and a blocking
  // third-party call would tank the perceived save latency.
  if (
    body.config !== undefined &&
    isJournalSupported(template?.code)
  ) {
    void syncDocumentToTasksFlow({
      documentId: id,
      organizationId: getActiveOrgId(session),
    }).catch((err) => {
      console.error("[tasksflow-sync] patch hook failed", err);
    });
  }

  // Live cell-edit sync для cleaning: если поменялась ячейка
  // СЕГОДНЯШНЕГО дня в matrix — upsert/delete override-задачу в TasksFlow
  // мгновенно, не дожидаясь следующего bulk-assign. T → G в ячейке
  // → у уборщицы в TF меняется (или появляется) задача «🧹 Генеральная
  // уборка · цех X». Fire-and-forget — TF outage не блокирует save.
  if (
    template?.code === "cleaning" &&
    body.config !== undefined &&
    typeof body.config === "object" &&
    body.config !== null
  ) {
    const prevMatrix =
      ((doc.config as { matrix?: Record<string, Record<string, string>> })
        ?.matrix ?? {}) as Record<string, Record<string, string>>;
    const nextMatrix =
      ((body.config as { matrix?: Record<string, Record<string, string>> })
        .matrix ?? {}) as Record<string, Record<string, string>>;
    const todayKey = new Date().toISOString().slice(0, 10);
    void syncTodayMatrixChanges({
      documentId: id,
      organizationId: getActiveOrgId(session),
      prevMatrix,
      nextMatrix,
      todayKey,
    }).catch((err) => {
      console.error("[cleaning-cell-override] hook failed", err);
    });
  }

  return NextResponse.json({ document: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const doc = await db.journalDocument.findUnique({ where: { id } });
  if (!doc || doc.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // Задачи TasksFlow этого документа: локальные ссылки удаляем сами, а
  // удаление самих задач кладём в outbox (П-12/П-15/П-19 — см.
  // `journal-document-tasks-cleanup.ts`). Прямых вызовов TF API здесь нет.
  const links = await db.tasksFlowTaskLink.findMany({
    where: { journalDocumentId: id },
    select: { integrationId: true, tasksflowTaskId: true },
  });
  const commands = buildDocumentTaskDeleteCommands({
    organizationId: doc.organizationId,
    journalDocumentId: id,
    links,
  });

  await db.$transaction(async (tx) => {
    for (const command of commands) {
      // Дубль по idempotencyKey — команда уже в очереди с прошлой попытки.
      await tx.tasksFlowOutbox
        .create({
          data: {
            integrationId: command.integrationId,
            organizationId: command.organizationId,
            idempotencyKey: command.idempotencyKey,
            action: command.action,
            payload: command.payload as Prisma.InputJsonValue,
            status: TasksFlowOutboxStatus.pending,
          },
        })
        .catch((err: unknown) => {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            return null;
          }
          throw err;
        });
    }
    await tx.tasksFlowTaskLink.deleteMany({ where: { journalDocumentId: id } });
    await tx.journalDocument.delete({ where: { id } });
  });

  return NextResponse.json({ success: true, tasksQueuedForDeletion: commands.length });
}
