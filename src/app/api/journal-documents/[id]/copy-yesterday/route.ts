import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { HYGIENE_V2_NO_COPY_MESSAGE, readHygieneFormVersion } from "@/lib/hygiene-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Скопировать вчерашнее» — for JournalDocumentEntry-based daily
 * journals (hygiene, health_check, cold_equipment_control,
 * cleaning_ventilation_checklist, climate_control, uv_lamp_runtime,
 * fryer_oil…) clone every yesterday row into today in one shot.
 *
 *   POST /api/journal-documents/<id>/copy-yesterday
 *   Body: { overwrite?: boolean }   // default false
 *
 * Behaviour:
 *   - Finds all entries where `date == yesterday (UTC-midnight)` in this
 *     document.
 *   - For each, upserts today's row with the same `data` blob.
 *   - If `overwrite === false` (default) and today's row already has
 *     data, it is KEPT — only missing rows are filled. This matches the
 *     «если значения не изменились» spirit: don't clobber fresh input.
 *   - If `overwrite === true`, today's rows are overwritten with
 *     yesterday's data. The UI should get a confirm dialog for that.
 *
 * Returns: { copied, kept, yesterdayKey, todayKey }
 */

type Body = { overwrite?: boolean };

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function toPrismaJsonValue(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const overwrite = Boolean(body?.overwrite);

  const organizationId = getActiveOrgId(session);
  const doc = await db.journalDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      status: true,
      organizationId: true,
      dateFrom: true,
      dateTo: true,
      config: true,
      template: { select: { code: true } },
    },
  });
  if (!doc || doc.organizationId !== organizationId) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (doc.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }
  // Гигиена по форме Приложения №1: подпись — личная отметка сотрудника
  // по QR, вчерашнюю на сегодня не переносим.
  if (doc.template?.code === "hygiene" && readHygieneFormVersion(doc.config) === 2) {
    return NextResponse.json({ error: HYGIENE_V2_NO_COPY_MESSAGE }, { status: 400 });
  }

  const now = new Date();
  const today = utcDayStart(now);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const todayEnd = new Date(today);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  // Sanity: today must be within the document's period.
  if (today < doc.dateFrom || today >= (() => {
    const end = new Date(doc.dateTo);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  })()) {
    return NextResponse.json(
      { error: "Сегодня не попадает в период документа" },
      { status: 400 }
    );
  }

  // Из «вчера» исключаем _autoSeeded плейсхолдеры — иначе copy-yesterday
  // склонировал бы пустые болванки как сегодняшнее «заполнение». Из
  // «сегодня» — исключаем чтобы не считать seeded как «занятый день».
  const [yesterdayEntries, todayEntries] = await Promise.all([
    db.journalDocumentEntry.findMany({
      where: { documentId, date: yesterday, ...NOT_AUTO_SEEDED },
      select: { employeeId: true, data: true },
    }),
    db.journalDocumentEntry.findMany({
      where: { documentId, date: today, ...NOT_AUTO_SEEDED },
      select: { employeeId: true },
    }),
  ]);

  if (yesterdayEntries.length === 0) {
    return NextResponse.json(
      {
        copied: 0,
        kept: todayEntries.length,
        yesterdayKey: yesterday.toISOString().slice(0, 10),
        todayKey: today.toISOString().slice(0, 10),
        message: "Вчера записей не было — копировать нечего.",
      },
      { status: 200 }
    );
  }

  const todayFilledEmployeeIds = new Set(
    todayEntries.map((e) => e.employeeId)
  );

  let copied = 0;
  let kept = 0;
  for (const entry of yesterdayEntries) {
    const alreadyHasToday = todayFilledEmployeeIds.has(entry.employeeId);
    if (alreadyHasToday && !overwrite) {
      kept += 1;
      continue;
    }
    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId,
          employeeId: entry.employeeId,
          date: today,
        },
      },
      create: {
        documentId,
        employeeId: entry.employeeId,
        date: today,
        data: toPrismaJsonValue(entry.data),
      },
      update: {
        data: toPrismaJsonValue(entry.data),
      },
    });
    copied += 1;
  }

  return NextResponse.json({
    copied,
    kept,
    yesterdayKey: yesterday.toISOString().slice(0, 10),
    todayKey: today.toISOString().slice(0, 10),
  });
}
