import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { reconcileEntryStaffFields } from "@/lib/journal-staff-binding";
import { isManagementRole } from "@/lib/user-roles";
import {
  isCellLocked,
  PAST_DAY_LOCKED_MESSAGE,
  type AutomationLockContext,
} from "@/lib/closed-day";
import { canWriteJournal } from "@/lib/journal-acl";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE } from "@/lib/cold-equipment-document";
import { processColdEquipmentEntryDeviations } from "@/lib/temperature-deviations";
import {
  checkEntryWrite,
  isValidDate,
  loadEntryWriteContext,
  logPastDayOverride,
  maybeTriggerColdEquipmentCapaDetection,
  toPrismaJsonValue,
  type EntryWriteActor,
  type EntryWriteDoc,
} from "@/lib/journal-entry-write";
import { checkEntryScope } from "@/lib/journal-entry-write";
import { orgTodayKey } from "@/lib/timezone";
import { decideEntryMove } from "@/lib/tracked-document";
import { findHygieneAdmissionViolation } from "@/lib/hygiene-admission-guard";

/**
 * Контекст автоматического запрета «день в день» — для PATCH/DELETE,
 * которым нужен только он. Полный контекст (плюс `lockPastDayEdits`)
 * живёт в `@/lib/journal-entry-write` и общий с bulk-роутом.
 */
async function loadAutomationLockContext(
  doc: EntryWriteDoc
): Promise<AutomationLockContext> {
  return (await loadEntryWriteContext(doc)).automation;
}

/**
 * PUT — upsert a single grid cell (employee + date + data).
 * Called on each cell edit in the grid UI.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const doc = await db.journalDocument.findUnique({
    where: { id: documentId },
    include: { template: { select: { code: true } } },
  });
  if (!doc || doc.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  if (doc.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  // ACL: PUT не проверял canWriteJournal — любой authenticated юзер мог
  // через прямой fetch писать в grid любого journal-документа org-и.
  const aclActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (doc.template?.code && !(await canWriteJournal(aclActor, doc.template.code))) {
    return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  }

  const body = await request.json();
  const { employeeId, date, data } = body;
  // Правка существующей строки шлёт её id: без него смена даты или
  // сотрудника делала upsert по новой паре и оставляла дубль.
  const entryId = typeof body.entryId === "string" && body.entryId ? body.entryId : null;

  if (!employeeId || !date || !data) {
    return NextResponse.json({ error: "employeeId, date, data обязательны" }, { status: 400 });
  }

  // Аккаунтабилити: рядовой сотрудник заполняет только СВОЮ строку и
  // только сегодняшний день. Раньше принимался произвольный employeeId —
  // Алёна могла прямым fetch'ем записать «выполнено» на строку коллеги
  // Бори и подделать его подпись. День проверяем потому, что журнал
  // санитарного контроля подтверждает: проверка была В ТОТ день.
  //
  // Руководство и ответственный за журнал этим правилом не связаны — им
  // положено исправлять чужие ошибки, в том числе вчерашние.
  {
    const scopeOrg = await db.organization.findUnique({
      where: { id: getActiveOrgId(session) },
      select: { timezone: true },
    });
    const scope = checkEntryScope({
      actor: {
        id: session.user.id,
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      },
      responsibleUserId: doc.responsibleUserId,
      employeeId,
      entryDayKey: String(date).slice(0, 10),
      todayKey: orgTodayKey(scopeOrg?.timezone ?? undefined),
    });
    if (!scope.allowed) {
      return NextResponse.json(
        { error: scope.error, code: scope.code },
        { status: 403 }
      );
    }
  }

  // Verify employee belongs to org
  const employee = await db.user.findFirst({
    where: { id: employeeId, organizationId: getActiveOrgId(session) },
    // Должность из справочника — её подставляет reconcileEntryStaffFields.
    include: { jobPosition: { select: { name: true } } },
  });
  if (!employee) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  // Truncate to date-only (midnight UTC)
  const dateObj = new Date(date);
  if (!isValidDate(dateObj)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  dateObj.setUTCHours(0, 0, 0, 0);

  const docDateFrom = new Date(doc.dateFrom);
  docDateFrom.setUTCHours(0, 0, 0, 0);
  const docDateTo = new Date(doc.dateTo);
  docDateTo.setUTCHours(0, 0, 0, 0);

  if (dateObj < docDateFrom || dateObj > docDateTo) {
    return NextResponse.json(
      { error: "Дата записи должна попадать в период документа" },
      { status: 400 }
    );
  }

  // Запреты «прошлый день закрыт» — общие с bulk-роутом (см.
  // journal-entry-write.ts): жёсткий автоматический и опциональный
  // организационный. Оба пишут override в AuditLog.
  const actor: EntryWriteActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
    name: session.user.name ?? null,
  };
  const writeCtx = await loadEntryWriteContext(doc);
  const decision = checkEntryWrite(writeCtx, actor, dateObj);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.error, code: decision.code },
      { status: 403 }
    );
  }
  if (decision.isOverride) {
    await logPastDayOverride({
      organizationId: doc.organizationId,
      actor,
      documentId,
      employeeId,
      dates: [dateObj],
      templateCode: doc.template?.code ?? null,
    });
  }

  // Гигиена: «Допущен» — только после ответа сотрудника о здоровье за
  // этот день (пожелание РПН). Ответ сверяется с записью в базе.
  {
    const editedEntry = entryId
      ? await db.journalDocumentEntry.findFirst({
          where: { id: entryId, documentId },
          select: { data: true },
        })
      : null;
    const admissionError = await findHygieneAdmissionViolation(db, {
      templateCode: doc.template?.code,
      documentId,
      config: doc.config,
      items: [{ employeeId, date: dateObj, data }],
      previousOverride: editedEntry,
    });
    if (admissionError) {
      return NextResponse.json(
        { error: admissionError, code: "admission_needs_health_answer" },
        { status: 409 }
      );
    }
  }

  const nextData = toPrismaJsonValue(reconcileEntryStaffFields(data, employee));

  let entry;
  if (entryId) {
    const [current, occupant] = await Promise.all([
      db.journalDocumentEntry.findUnique({
        where: { id: entryId },
        select: { id: true, documentId: true },
      }),
      db.journalDocumentEntry.findUnique({
        where: {
          documentId_employeeId_date: { documentId, employeeId, date: dateObj },
        },
        select: { id: true },
      }),
    ]);
    const move = decideEntryMove({ documentId, current, occupant });
    if (move.action === "not_found") {
      return NextResponse.json({ error: move.error }, { status: 404 });
    }
    if (move.action === "conflict") {
      return NextResponse.json(
        { error: move.error, code: "entry_slot_taken" },
        { status: 409 }
      );
    }
    entry = await db.journalDocumentEntry.update({
      where: { id: move.entryId },
      data: { employeeId, date: dateObj, data: nextData },
    });
  } else {
    entry = await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId,
          employeeId,
          date: dateObj,
        },
      },
      update: { data: nextData },
      create: {
        documentId,
        employeeId,
        date: dateObj,
        data: nextData,
      },
    });
  }

  maybeTriggerColdEquipmentCapaDetection(
    doc.template?.code,
    getActiveOrgId(session)
  );

  // Отклонение температуры в сетке холодильников — основной путь ввода
  // у заведений без датчиков. Раньше эта запись не уведомляла никого.
  // Не ждём отправку: сохранение ячейки не должно тормозить из-за
  // Telegram (обработчик сам глушит свои ошибки).
  if (doc.template?.code === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    void processColdEquipmentEntryDeviations({
      organizationId: doc.organizationId,
      documentId: doc.id,
      documentConfig: doc.config,
      entryData: entry.data,
      source: employee.name,
    });
  }

  return NextResponse.json({ entry });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const doc = await db.journalDocument.findUnique({
    where: { id: documentId },
    include: { template: { select: { code: true } } },
  });
  if (!doc || doc.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  if (doc.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        entries?: Array<{ employeeId?: string; date?: string; data?: unknown }>;
        replaceAll?: boolean;
      }
    | null;

  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: "entries должны быть массивом" }, { status: 400 });
  }

  // ПОЧЕМУ по умолчанию НЕ «заменить всё»: клиент шлёт только те строки,
  // которые правил. Прежнее поведение удаляло записи, добавленные другим
  // человеком уже после загрузки страницы. Удаление строки — отдельный
  // DELETE. Старую семантику можно запросить явным `replaceAll: true`.
  const replaceAll = body.replaceAll === true;

  const payloadEntries = body.entries;
  const docDateFrom = new Date(doc.dateFrom);
  docDateFrom.setUTCHours(0, 0, 0, 0);
  const docDateTo = new Date(doc.dateTo);
  docDateTo.setUTCHours(0, 0, 0, 0);

  const candidateEmployeeIds = [...new Set(
    payloadEntries
      .map((entry) => (entry?.employeeId ? String(entry.employeeId) : ""))
      .filter(Boolean)
  )];
  const employees = await db.user.findMany({
    where: {
      id: { in: candidateEmployeeIds },
      organizationId: getActiveOrgId(session),
    },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
    },
  });

  const normalizedEntries: Array<{
    employeeId: string;
    date: Date;
    data: unknown;
  }> = payloadEntries.map((entry) => {
    if (!entry?.employeeId || !entry.date || entry.data === undefined) {
      throw new Error("employeeId, date, data обязательны");
    }

    const dateObj = new Date(entry.date);
    if (!isValidDate(dateObj)) {
      throw new Error("Некорректная дата");
    }
    dateObj.setUTCHours(0, 0, 0, 0);

    if (dateObj < docDateFrom || dateObj > docDateTo) {
      throw new Error("Дата записи должна попадать в период документа");
    }

    const employee = employees.find((item) => item.id === entry.employeeId);

    return {
      employeeId: entry.employeeId,
      date: dateObj,
      data: employee ? reconcileEntryStaffFields(entry.data, employee) : entry.data,
    };
  });

  // Автодокумент: пересобрать прошлые дни bulk-запросом тоже нельзя.
  const patchLockCtx = await loadAutomationLockContext(doc);
  const lockedEntry = normalizedEntries.find((entry) =>
    isCellLocked(entry.date, patchLockCtx)
  );
  if (lockedEntry && session.user.isRoot !== true) {
    return NextResponse.json(
      { error: PAST_DAY_LOCKED_MESSAGE, code: "past_day_locked" },
      { status: 403 }
    );
  }
  if (lockedEntry) {
    await logPastDayOverride({
      organizationId: doc.organizationId,
      actor: {
        id: session.user.id,
        role: session.user.role,
        isRoot: session.user.isRoot === true,
        name: session.user.name ?? null,
      },
      documentId,
      employeeId: lockedEntry.employeeId,
      dates: [lockedEntry.date],
      templateCode: doc.template?.code ?? null,
      rule: "journal_automation",
    });
  }

  const uniqueEmployeeIds = [...new Set(normalizedEntries.map((entry) => entry.employeeId))];

  if (employees.length !== uniqueEmployeeIds.length) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  // Гигиена: «Допущен» — только после ответа сотрудника о здоровье.
  const admissionError = await findHygieneAdmissionViolation(db, {
    templateCode: doc.template?.code,
    documentId,
    config: doc.config,
    items: normalizedEntries,
  });
  if (admissionError) {
    return NextResponse.json(
      { error: admissionError, code: "admission_needs_health_answer" },
      { status: 409 }
    );
  }

  try {
    const result = await db.$transaction(async (tx) => {
      await Promise.all(
        normalizedEntries.map((entry) =>
          tx.journalDocumentEntry.upsert({
            where: {
              documentId_employeeId_date: {
                documentId,
                employeeId: entry.employeeId,
                date: entry.date,
              },
            },
            update: { data: toPrismaJsonValue(entry.data) },
            create: {
              documentId,
              employeeId: entry.employeeId,
              date: entry.date,
              data: toPrismaJsonValue(entry.data),
            },
          })
        )
      );

      if (replaceAll) {
        const staleEntries = await tx.journalDocumentEntry.findMany({
          where: { documentId },
          select: { id: true, employeeId: true, date: true },
        });

        const keepKeys = new Set(
          normalizedEntries.map((entry) => `${entry.employeeId}:${entry.date.toISOString()}`)
        );
        const deleteIds = staleEntries
          .filter((entry) => !keepKeys.has(`${entry.employeeId}:${entry.date.toISOString()}`))
          .map((entry) => entry.id);

        if (deleteIds.length > 0) {
          await tx.journalDocumentEntry.deleteMany({
            where: {
              documentId,
              id: { in: deleteIds },
            },
          });
        }
      }

      return tx.journalDocumentEntry.findMany({
        where: { documentId },
        orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      });
    });

    maybeTriggerColdEquipmentCapaDetection(
      doc.template?.code,
      getActiveOrgId(session)
    );

    return NextResponse.json({ entries: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить записи" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const doc = await db.journalDocument.findUnique({
    where: { id: documentId },
    include: { template: { select: { code: true } } },
  });
  if (!doc || doc.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  if (doc.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    employeeId?: string;
    date?: string;
  };

  // Удаление — тоже правка прошлого дня: в автодокументе строку за
  // вчера убрать нельзя, иначе запрет на редактирование обходится
  // «удалить и создать заново».
  const deleteLockCtx = await loadAutomationLockContext(doc);
  if (
    deleteLockCtx.documentAutoFill &&
    deleteLockCtx.automationEnabled &&
    session.user.isRoot !== true
  ) {
    const candidates = await db.journalDocumentEntry.findMany({
      where: {
        documentId,
        ...(Array.isArray(body.ids) && body.ids.length > 0
          ? { id: { in: body.ids } }
          : {}),
        ...(body.employeeId ? { employeeId: body.employeeId } : {}),
      },
      select: { date: true },
    });
    if (candidates.some((entry) => isCellLocked(entry.date, deleteLockCtx))) {
      return NextResponse.json(
        { error: PAST_DAY_LOCKED_MESSAGE, code: "past_day_locked" },
        { status: 403 }
      );
    }
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const result = await db.journalDocumentEntry.deleteMany({
      where: {
        documentId,
        id: { in: body.ids },
      },
    });

    return NextResponse.json({ deleted: result.count });
  }

  if (body.employeeId && body.date) {
    const dateObj = new Date(body.date);
    if (!isValidDate(dateObj)) {
      return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    }
    dateObj.setUTCHours(0, 0, 0, 0);

    const result = await db.journalDocumentEntry.deleteMany({
      where: {
        documentId,
        employeeId: body.employeeId,
        date: dateObj,
      },
    });

    return NextResponse.json({ deleted: result.count });
  }

  if (body.employeeId) {
    const result = await db.journalDocumentEntry.deleteMany({
      where: {
        documentId,
        employeeId: body.employeeId,
      },
    });

    return NextResponse.json({ deleted: result.count });
  }

  return NextResponse.json(
    { error: "Нужно передать ids либо employeeId и date" },
    { status: 400 }
  );
}
