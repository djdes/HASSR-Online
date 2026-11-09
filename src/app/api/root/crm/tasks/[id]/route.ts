import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, readJson } from "@/lib/crm/api.server";
import { CrmTaskError, closeCrmTask, decideDiscount } from "@/lib/crm/tasks.server";
import { platformViewerForSession } from "@/lib/platform-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["done", "cancel", "approve", "reject"]),
  result: z.string().max(2000).nullish(),
  percent: z.number().int().min(0).max(90).nullish(),
});

/** PATCH /api/root/crm/tasks/:id — выполнено, отменить, согласовать или отказать в скидке. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  const viewer = await platformViewerForSession(session);
  const actor = { id: session.user.id, name: session.user.name ?? null, superadmin: viewer.superadmin };
  try {
    const { action, result, percent } = parsed.data;
    if (action === "approve" || action === "reject") await decideDiscount(id, actor, { approve: action === "approve", percent: percent ?? null, comment: result ?? null });
    else await closeCrmTask(id, actor, { status: action === "done" ? "done" : "cancelled", result: result ?? null });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CrmTaskError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[crm-tasks] patch failed", error);
    return NextResponse.json({ error: "Не получилось — попробуйте ещё раз" }, { status: 500 });
  }
}
