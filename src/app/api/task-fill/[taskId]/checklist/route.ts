import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/task-fill/[taskId]/checklist?token=... — список пунктов
 * чеклиста для journalCode задачи + текущее состояние галочек этого
 * сотрудника в рамках этой задачи.
 *
 * Auth — HMAC token из TasksFlow (per-integration secret).
 *
 * POST — toggle одного пункта. Body: {token, itemId, checked}.
 *   Записывает append-only `JournalChecklistCheck` + AuditLog.
 *   Audit-log пишет org-уровень — ROOT увидит на /root/audit.
 */

function ipFor(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

/** Найти link+verify token по per-integration webhook-secret. */
async function resolveTaskFillLink(taskId: number, token: string) {
  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  for (const c of candidates) {
    const v = verifyTaskFillToken(token, c.integration.webhookSecret);
    if (v.ok && v.taskId === taskId) return c;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId: taskIdRaw } = await params;
  const taskId = Number(taskIdRaw);
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!Number.isFinite(taskId) || !token) {
    return NextResponse.json({ errorCode: "invalidBody", error: "Bad request" }, { status: 400 });
  }

  const link = await resolveTaskFillLink(taskId, token);
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }
  const organizationId = link.integration.organizationId;

  // Cleaning: scope-шаги уже доставляются через TaskFormSchema.pipeline
  // (см. cleaningAdapter.getTaskForm — buildRoomCleaningFormFromDb
  // возвращает pipeline по Room.currentScope/generalScope в зависимости
  // от matrix-значения T/G сегодня). Чтобы не показывать одни и те же
  // шаги дважды (TaskFillChecklist сверху + pipeline-wizard снизу),
  // отдаём пустой checklist для cleaning. Pipeline — единственный
  // источник UX. Юзер: «Зачем чек-лист и где pipeline» — после этой
  // правки виден только wizard. См. spec
  // docs/superpowers/specs/2026-05-08-cleaning-unification.md
  if (link.journalCode === "cleaning") {
    return NextResponse.json({ items: [] });
  }

  // Парсим roomId из rowKey. Поддерживаемые форматы:
  //   • room::<roomId>::cleaner::<uid>   (cleaning rooms-mode)
  //   • cell-override::<roomId>::<date>  (cleaning override-cell)
  //   • employee-<uid>                    (per-employee — roomId=null)
  //   • прочее                            (roomId=null)
  // Если в rowKey есть roomId, фильтруем чек-лист по нему +
  // по общим (roomId=null) пунктам.
  let rowRoomId: string | null = null;
  let cellDateKey: string | null = null;
  const roomMatch = /^room::([^:]+)::cleaner::/.exec(link.rowKey);
  if (roomMatch) rowRoomId = roomMatch[1];
  const overrideMatch = /^cell-override::([^:]+)::(\d{4}-\d{2}-\d{2})$/.exec(
    link.rowKey,
  );
  if (overrideMatch) {
    rowRoomId = overrideMatch[1];
    cellDateKey = overrideMatch[2];
  }

  // Для cleaning: определяем тип уборки сегодня (T или G) и фильтруем
  // checklist-items по category. Раньше показывали и currentScope, и
  // generalScope одновременно — сотрудник видел ВСЕ пункты сразу,
  // непонятно что делать. Теперь:
  //   • матрица сегодня = "G" → только category="general"
  //   • матрица сегодня = "T" → только category="current"
  //   • матрица пустая или прочее → category in ["current", null]
  //     (default — текущая уборка + legacy items без категории)
  let cleaningCategoryFilter: ("current" | "general")[] | null = null;
  if (link.journalCode === "cleaning" && rowRoomId) {
    const cleaningDoc = await db.journalDocument.findUnique({
      where: { id: link.journalDocumentId },
      select: { config: true },
    });
    const matrix =
      ((cleaningDoc?.config as { matrix?: Record<string, Record<string, string>> })
        ?.matrix ?? {}) as Record<string, Record<string, string>>;
    const todayKey =
      cellDateKey ?? new Date().toISOString().slice(0, 10);
    const cellValue = matrix[rowRoomId]?.[todayKey] ?? "";
    if (cellValue === "G") {
      cleaningCategoryFilter = ["general"];
    } else if (cellValue === "T") {
      cleaningCategoryFilter = ["current"];
    } else {
      // По умолчанию — current (ежедневная). Generalka не нагружает.
      cleaningCategoryFilter = ["current"];
    }
  }

  const [allItems, latestChecks] = await Promise.all([
    db.journalChecklistItem.findMany({
      where: {
        organizationId,
        journalCode: link.journalCode,
        archivedAt: null,
        // Либо общие (roomId=null), либо привязанные к этой комнате.
        OR: rowRoomId
          ? [{ roomId: null }, { roomId: rowRoomId }]
          : [{ roomId: null }],
        // Для cleaning: только items соответствующей категории
        // (current/general) + legacy items без category. Prisma
        // не позволяет null в `in`, поэтому используем AND/OR.
        ...(cleaningCategoryFilter
          ? {
              AND: [
                {
                  OR: [
                    { category: { in: cleaningCategoryFilter } },
                    { category: null },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ roomId: "asc" }, { sortOrder: "asc" }],
    }),
    db.journalChecklistCheck.findMany({
      where: {
        organizationId,
        taskFillTaskId: taskId,
        rowKey: link.rowKey,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Фильтр по частоте: показываем пункт только если по расписанию
  // он сегодня уместен.
  //   • daily   — всегда
  //   • weekly  — если сегодняшний weekday в weekDays[]
  //   • monthly — если сегодняшняя day-of-month == monthDay
  //                (с clip'ом для коротких месяцев)
  const today = new Date();
  const todayWeekday = ((today.getDay() + 6) % 7) + 1; // 1=Пн ... 7=Вс
  const todayDay = today.getDate();
  const lastDayOfThisMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();

  const items = allItems.filter((it) => {
    if (it.frequency === "weekly") {
      return Array.isArray(it.weekDays) && it.weekDays.includes(todayWeekday);
    }
    if (it.frequency === "monthly") {
      if (it.monthDay == null) return false;
      const effectiveDay = Math.min(it.monthDay, lastDayOfThisMonth);
      return todayDay === effectiveDay;
    }
    return true; // daily
  });

  // Для каждого пункта — последняя по createdAt запись.
  const stateById: Record<string, boolean> = {};
  for (const c of latestChecks) {
    if (!(c.checklistItemId in stateById)) {
      stateById[c.checklistItemId] = c.checked;
    }
  }

  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id,
      label: i.label,
      required: i.required,
      hint: i.hint,
      sortOrder: i.sortOrder,
      roomId: i.roomId,
      frequency: i.frequency,
    })),
    checks: stateById,
    rowRoomId,
  });
}

const ToggleBody = z.object({
  token: z.string().min(1),
  itemId: z.string().min(1),
  checked: z.boolean(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId: taskIdRaw } = await params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const parsed = ToggleBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errorCode: "invalidBody", error: "Bad body" }, { status: 400 });
  }

  const link = await resolveTaskFillLink(taskId, parsed.data.token);
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }
  const organizationId = link.integration.organizationId;

  const item = await db.journalChecklistItem.findFirst({
    where: {
      id: parsed.data.itemId,
      organizationId,
      journalCode: link.journalCode,
      archivedAt: null,
    },
  });
  if (!item) {
    return NextResponse.json({ errorCode: "itemNotFound", error: "Item not found" }, { status: 404 });
  }

  const employeeId = extractEmployeeId(link.rowKey);
  let checkedByName: string | null = null;
  let checkedByUserId: string | null = null;
  if (employeeId) {
    const u = await db.user.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true },
    });
    if (u) {
      checkedByUserId = u.id;
      checkedByName = u.name;
    }
  }

  const checkRecord = await db.journalChecklistCheck.create({
    data: {
      organizationId,
      checklistItemId: item.id,
      taskFillTaskId: taskId,
      rowKey: link.rowKey,
      checked: parsed.data.checked,
      checkedByUserId,
      checkedByName,
      ipAddress: ipFor(request),
    },
  });

  await recordAuditLog({
    request,
    organizationId,
    action: parsed.data.checked
      ? "checklist.check.set"
      : "checklist.check.unset",
    entity: "JournalChecklistCheck",
    entityId: checkRecord.id,
    details: {
      journalCode: link.journalCode,
      itemLabel: item.label,
      itemRequired: item.required,
      taskFillTaskId: taskId,
      employeeName: checkedByName,
    },
  });

  return NextResponse.json({ ok: true, check: checkRecord });
}
