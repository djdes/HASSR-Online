import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, readJson } from "@/lib/crm/api.server";
import { CrmTaskError, closeCrmTask, decideDiscount } from "@/lib/crm/tasks.server";
import { TASK_OUTCOME_KEYS } from "@/lib/lifecycle/task-outcomes";
import { platformViewerForSession } from "@/lib/platform-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["done", "cancel", "approve", "reject"]),
  result: z.string().max(2000).nullish(),
  percent: z.number().int().min(0).max(90).nullish(),
  /** Итог звонка: двигает сделку воронки. */
  outcome: z.enum(TASK_OUTCOME_KEYS).nullish(),
  /** Следующий шаг — задача «Перезвонить» на это время. */
  nextDueAt: z.string().datetime({ offset: true, message: "Укажите дату и время следующего шага" }).nullish(),
});

/** PATCH /api/root/crm/tasks/:id — выполнено (с итогом и следующим шагом), отменить, согласовать или отказать в скидке. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  const viewer = await platformViewerForSession(session);
  const actor = { id: session.user.id, name: session.user.name ?? null, superadmin: viewer.superadmin, own: viewer.scope === "own" };
  try {
    const { action, result, percent, outcome, nextDueAt } = parsed.data;
    if (action === "approve" || action === "reject") {
      const decided = await decideDiscount(id, actor, { approve: action === "approve", percent: percent ?? null, comment: result ?? null });
      return NextResponse.json({ ok: true, offerTaskId: decided.offerTaskId });
    }
    const next = nextDueAt ? new Date(nextDueAt) : null;
    if (next && next.getTime() < Date.now() - 60 * 1000) return NextResponse.json({ error: "Следующий шаг — в будущем" }, { status: 400 });
    const closed = await closeCrmTask(id, actor, { status: action === "done" ? "done" : "cancelled", result: result ?? null, outcome: outcome ?? null, nextDueAt: next });
    return NextResponse.json({ ok: true, followUpId: closed.followUpId });
  } catch (error) {
    if (error instanceof CrmTaskError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[crm-tasks] patch failed", error);
    return NextResponse.json({ error: "Не получилось — попробуйте ещё раз" }, { status: 500 });
  }
}
