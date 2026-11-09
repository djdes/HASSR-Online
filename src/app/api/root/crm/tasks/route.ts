import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { badRequest, readJson } from "@/lib/crm/api.server";
import { createCrmTask, notifyTaskAssignee } from "@/lib/crm/tasks.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(2, "Напишите, что сделать").max(200),
  note: z.string().trim().max(2000).nullish(),
  assigneeId: z.string().min(1).nullish(),
  dueAt: z.string().datetime({ offset: true }),
  organizationId: z.string().min(1).nullish(),
  contactId: z.string().min(1).nullish(),
});

/** POST /api/root/crm/tasks — задача руками: кому, что и к какому сроку. */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues);
  const task = await createCrmTask({
    kind: "manual",
    title: parsed.data.title,
    note: parsed.data.note ?? null,
    assigneeId: parsed.data.assigneeId ?? session.user.id,
    dueAt: new Date(parsed.data.dueAt),
    organizationId: parsed.data.organizationId ?? null,
    contactId: parsed.data.contactId ?? null,
    createdById: session.user.id,
  });
  if (task && task.assigneeId !== session.user.id) await notifyTaskAssignee(task).catch(() => 0);
  return NextResponse.json({ ok: true, id: task?.id ?? null });
}
