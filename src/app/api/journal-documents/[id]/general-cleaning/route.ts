import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { roomGeneralSchedule } from "@/lib/general-cleaning-schedule";
import {
  GeneralCleaningOpError,
  MANAGEMENT_ONLY_GENERAL_CLEANING_OPS,
  applyGeneralCleaningOp,
  parseGeneralCleaningOp,
  type GeneralCleaningOpResult,
} from "@/lib/general-cleaning-ops";
import { canWriteJournal } from "@/lib/journal-acl";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import { getServerSession } from "@/lib/server-session";
import { orgTodayKey } from "@/lib/timezone";
import { syncDocumentToTasksFlow } from "@/lib/tasksflow-sync";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";

const CLOSED_ERROR = "Закрытый документ нельзя редактировать до перевода в активные";

/**
 * POST /api/journal-documents/[id]/general-cleaning  { op }
 *
 * Одна правка «Графика и учета генеральных уборок»: добавить дату в
 * план, перенести, отметить выполненной, внеплановая уборка, «заполнить
 * по графику помещений», сменить год (см. `general-cleaning-ops.ts`).
 *
 * Операция применяется к СВЕЖЕМУ конфигу под блокировкой строки
 * документа — той же, под которой адаптер TasksFlow пишет выполнение
 * задач, — поэтому быстрые клики, две вкладки и закрытая задача не
 * затирают друг друга. Права — как у правки только конфига: руководитель
 * или сотрудник с правом записи в журнал; массовые операции («по
 * графику», смена года) — только руководитель.
 *
 * После записи: TasksFlow (задача на сегодняшнюю уборку, удаление задач
 * по убранным датам) — fire-and-forget через outbox, и запись в AuditLog.
 * Ответ — нормализованный конфиг `{ config }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const organizationId = getActiveOrgId(session);

  const doc = await db.journalDocument.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      status: true,
      template: { select: { code: true } },
    },
  });
  if (
    !doc ||
    doc.organizationId !== organizationId ||
    doc.template.code !== SANITATION_DAY_TEMPLATE_CODE
  ) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const op = parseGeneralCleaningOp(
    body && typeof body === "object" ? (body as { op?: unknown }).op : null,
  );
  if (!op) {
    return NextResponse.json({ error: "Некорректная операция" }, { status: 400 });
  }

  const actor = {
    id: session.user.id,
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  };
  if (!isManagementRole(actor.role) && !actor.isRoot) {
    if (MANAGEMENT_ONLY_GENERAL_CLEANING_OPS.has(op.type)) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }
    if (!(await canWriteJournal(actor, SANITATION_DAY_TEMPLATE_CODE))) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }
  }
  if (doc.status === "closed") {
    return NextResponse.json({ error: CLOSED_ERROR }, { status: 400 });
  }

  const [org, rooms] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.room.findMany({
      where: { building: { organizationId } },
      select: { id: true, generalScheduleType: true, generalDays: true, generalMonthDays: true },
    }),
  ]);
  const ctx = {
    todayKey: orgTodayKey(org?.timezone ?? undefined),
    userId: session.user.id,
    schedules: new Map(rooms.map((room) => [room.id, roomGeneralSchedule(room)])),
  };

  let outcome: GeneralCleaningOpResult | null;
  try {
    outcome = await withDocumentConfigLock(id, async (locked) => {
      if (locked.status === "closed") throw new GeneralCleaningOpError(CLOSED_ERROR);
      const result = applyGeneralCleaningOp(normalizeSanitationDayConfig(locked.config), op, ctx);
      if (!result.changed) return { result };
      // Прочие ключи конфига (шапка бланка, closedAt) — как были.
      const extras =
        locked.config && typeof locked.config === "object" && !Array.isArray(locked.config)
          ? (locked.config as Record<string, unknown>)
          : {};
      return {
        config: { ...extras, ...result.config } as unknown as Prisma.InputJsonValue,
        result,
      };
    });
  } catch (err) {
    if (err instanceof GeneralCleaningOpError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  if (!outcome) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  if (outcome.changed) {
    void syncDocumentToTasksFlow({ documentId: id, organizationId }).catch((err) => {
      console.error("[general-cleaning] tasksflow sync failed", err);
    });
    await db.auditLog
      .create({
        data: {
          organizationId,
          userId: session.user.id,
          userName: session.user.name ?? session.user.email ?? null,
          action: "general_cleaning.op",
          entity: "JournalDocument",
          entityId: id,
          details: {
            op: op.type,
            ...("rowId" in op ? { rowId: op.rowId } : {}),
            touchedDates: outcome.touchedDates.slice(0, 60),
          },
        },
      })
      .catch((err) => console.error("[general-cleaning] audit failed", err));
  }

  return NextResponse.json({ config: outcome.config, changed: outcome.changed });
}
