import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { getAdapter } from "@/lib/tasksflow-adapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/task-fill/<taskId>/yesterday-prefill?token=...
 *
 * Возвращает values вчерашней записи (JournalDocumentEntry за вчера для
 * того же rowKey) — для кнопки «Заполнить как вчера». Юзер 5 дней
 * подряд делает hygiene «здоров, t° норма», на 6-й тапает кнопку и
 * не заполняет руками.
 *
 * Стратегия по типам журналов:
 *   - DocumentEntry-based (hygiene, health_check, cold_equipment_control,
 *     climate_control): вчерашняя entry с тем же employeeId. Возвращаем
 *     entry.data как key-value.
 *   - Config-based (intensive_cooling, finished_product) + legacy
 *     JournalEntry: пока not supported (там может быть много записей за
 *     вчера, prefill неоднозначен).
 *
 * Response:
 *   200 { values: Record<string,unknown>, source: "yesterday-entry" }
 *   200 { values: null, reason: "no-entry" | "not-supported" }
 *   401 invalid token
 */
function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdRaw } = await ctx.params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ errorCode: "missingToken", error: "token required" }, { status: 400 });
  }

  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ errorCode: "taskNotFound", error: "Task not found" }, { status: 404 });
  }
  let link: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const v = verifyTaskFillToken(token, c.integration.webhookSecret);
    if (v.ok && v.taskId === taskId) {
      link = c;
      break;
    }
  }
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }

  const adapter = getAdapter(link.journalCode);
  if (!adapter) {
    return NextResponse.json(
      { values: null, reason: "not-supported" },
      { status: 200 }
    );
  }

  const employeeId = extractEmployeeId(link.rowKey);
  if (!employeeId) {
    return NextResponse.json(
      { values: null, reason: "no-employee" },
      { status: 200 }
    );
  }

  const today = utcDayStart(new Date());
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  // Generic strategy: вчерашняя JournalDocumentEntry для (doc, employee, date).
  // Это покрывает hygiene, health_check, cold_equipment_control,
  // climate_control — большинство daily-journal'ов.
  const yEntry = await db.journalDocumentEntry.findUnique({
    where: {
      documentId_employeeId_date: {
        documentId: link.journalDocumentId,
        employeeId,
        date: yesterday,
      },
    },
    select: { data: true },
  });

  if (!yEntry) {
    return NextResponse.json({ values: null, reason: "no-entry" });
  }

  // entry.data shape варьируется per template — отдаём как есть, UI
  // на стороне task-fill маппит в form.values по совпадению ключей с
  // form.fields[].key.
  return NextResponse.json({
    values: yEntry.data,
    source: "yesterday-entry",
    yesterday: yesterday.toISOString().slice(0, 10),
  });
}
