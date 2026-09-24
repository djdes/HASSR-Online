import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { reconcileEntryStaffFields } from "@/lib/journal-staff-binding";
import { canWriteJournal } from "@/lib/journal-acl";
import {
  checkEntryWrite,
  loadEntryWriteContext,
  logPastDayOverride,
  maybeTriggerColdEquipmentCapaDetection,
  toEntryDayUtc,
  toPrismaJsonValue,
  type EntryWriteActor,
} from "@/lib/journal-entry-write";
import { checkEntryScope } from "@/lib/journal-entry-write";
import { orgTodayKey } from "@/lib/timezone";
import { HYGIENE_V2_NO_COPY_MESSAGE, readHygieneFormVersion } from "@/lib/hygiene-v2";
import { findHygieneAdmissionViolation } from "@/lib/hygiene-admission-guard";

/**
 * POST /api/journal-documents/[id]/entries/bulk
 *
 * Одна транзакция на всю «покраску» сетки журнала: раньше протянуть
 * курсором по двум сотрудникам × десяти дням означало 20 отдельных PUT
 * и 20 оптимистичных откатов при первой же ошибке.
 *
 * Guard'ы — ровно те же, что у PUT `../entries` (общий модуль
 * `journal-entry-write.ts`): ACL журнала, «только своя строка» для
 * рядовых, период документа и «прошлый день закрыт» НА КАЖДУЮ ячейку.
 * Отличие одно: запертые дни не валят весь запрос — такие ячейки
 * молча пропускаются и возвращаются счётчиком `skipped`, иначе штрих
 * поперёк границы «вчера/сегодня» не сохранил бы вообще ничего.
 */
const bulkSchema = z.object({
  items: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        date: z.string().min(1),
        data: z.unknown(),
      })
    )
    .min(1, "Пустой список")
    // Сетка — до 31 дня × штат; верхняя граница с запасом, чтобы кривой
    // клиент не прислал мегабайты.
    .max(2000, "Слишком много ячеек за один раз"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
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

  const actor: EntryWriteActor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
    name: session.user.name ?? null,
  };

  if (
    doc.template?.code &&
    !(await canWriteJournal(
      { id: actor.id, role: actor.role, isRoot: actor.isRoot },
      doc.template.code
    ))
  ) {
    return NextResponse.json(
      { error: "Нет доступа к этому журналу" },
      { status: 403 }
    );
  }

  let parsed;
  try {
    parsed = bulkSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Не удалось прочитать запрос" },
      { status: 400 }
    );
  }

  // Гигиена по форме Приложения №1: «Здоров» / «Отстранён» — это подпись
  // сотрудника по QR и допуск ответственного, штрихом их не проставить.
  // Выходной / отпуск / больничный красить можно.
  if (
    doc.template?.code === "hygiene" &&
    readHygieneFormVersion(doc.config) === 2 &&
    parsed.items.some((item) => {
      const status =
        item.data && typeof item.data === "object"
          ? (item.data as Record<string, unknown>).status
          : undefined;
      return status === "healthy" || status === "suspended";
    })
  ) {
    return NextResponse.json({ error: HYGIENE_V2_NO_COPY_MESSAGE }, { status: 400 });
  }

  // Аккаунтабилити: рядовой сотрудник красит только свою строку и только
  // сегодняшний день. Покраска мышью шлёт весь штрих одним запросом,
  // поэтому проверяем каждую ячейку: иначе достаточно было бы захватить
  // штрихом чужую строку или вчерашнюю колонку.
  const scopeOrg = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { timezone: true },
  });
  const todayKey = orgTodayKey(scopeOrg?.timezone ?? undefined);
  for (const item of parsed.items) {
    const scope = checkEntryScope({
      actor: { id: actor.id, role: actor.role, isRoot: actor.isRoot },
      responsibleUserId: doc.responsibleUserId,
      employeeId: item.employeeId,
      entryDayKey: String(item.date).slice(0, 10),
      todayKey,
    });
    if (!scope.allowed) {
      return NextResponse.json(
        { error: scope.error, code: scope.code },
        { status: 403 }
      );
    }
  }

  const employeeIds = [...new Set(parsed.items.map((item) => item.employeeId))];
  const employees = await db.user.findMany({
    where: { id: { in: employeeIds }, organizationId: getActiveOrgId(session) },
    include: { jobPosition: { select: { name: true } } },
  });
  if (employees.length !== employeeIds.length) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }
  const employeeById = new Map(employees.map((item) => [item.id, item]));

  const docDateFrom = new Date(doc.dateFrom);
  docDateFrom.setUTCHours(0, 0, 0, 0);
  const docDateTo = new Date(doc.dateTo);
  docDateTo.setUTCHours(0, 0, 0, 0);

  const writeCtx = await loadEntryWriteContext(doc);

  const accepted: Array<{ employeeId: string; date: Date; data: unknown }> = [];
  const overrideDates: Date[] = [];
  let skipped = 0;

  for (const item of parsed.items) {
    // `z.unknown()` пропускает и отсутствующее поле — до Prisma такое
    // доходить не должно.
    if (item.data === undefined || item.data === null) {
      return NextResponse.json({ error: "data обязательна" }, { status: 400 });
    }
    const dateObj = toEntryDayUtc(item.date);
    if (!dateObj) {
      return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    }
    if (dateObj < docDateFrom || dateObj > docDateTo) {
      return NextResponse.json(
        { error: "Дата записи должна попадать в период документа" },
        { status: 400 }
      );
    }

    const decision = checkEntryWrite(writeCtx, actor, dateObj);
    if (!decision.allowed) {
      // Запертый день не валит штрих целиком — просто не сохраняем.
      skipped += 1;
      continue;
    }
    if (decision.isOverride) overrideDates.push(dateObj);

    const employee = employeeById.get(item.employeeId);
    accepted.push({
      employeeId: item.employeeId,
      date: dateObj,
      data: employee
        ? reconcileEntryStaffFields(item.data, employee)
        : item.data,
    });
  }

  if (overrideDates.length > 0) {
    // Один лог на весь штрих: 60 строк аудита на одно движение мышью
    // только зашумили бы журнал событий.
    await logPastDayOverride({
      organizationId: doc.organizationId,
      actor,
      documentId,
      employeeId: null,
      dates: overrideDates,
      templateCode: doc.template?.code ?? null,
    });
  }

  if (accepted.length === 0) {
    return NextResponse.json({ saved: 0, skipped, reason: "past_day_locked" });
  }

  // Гигиена: «Допущен» — только после ответа сотрудника о здоровье.
  const admissionError = await findHygieneAdmissionViolation(db, {
    templateCode: doc.template?.code,
    documentId,
    config: doc.config,
    items: accepted,
  });
  if (admissionError) {
    return NextResponse.json(
      { error: admissionError, code: "admission_needs_health_answer" },
      { status: 409 }
    );
  }

  await db.$transaction(
    accepted.map((item) =>
      db.journalDocumentEntry.upsert({
        where: {
          documentId_employeeId_date: {
            documentId,
            employeeId: item.employeeId,
            date: item.date,
          },
        },
        update: { data: toPrismaJsonValue(item.data) },
        create: {
          documentId,
          employeeId: item.employeeId,
          date: item.date,
          data: toPrismaJsonValue(item.data),
        },
      })
    )
  );

  maybeTriggerColdEquipmentCapaDetection(
    doc.template?.code,
    getActiveOrgId(session)
  );

  return NextResponse.json({
    saved: accepted.length,
    skipped,
    ...(skipped > 0 ? { reason: "past_day_locked" as const } : {}),
  });
}
