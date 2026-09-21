import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  taskFlowMode: z.enum(["race", "shared", "manual"]),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { taskFlowMode: true },
  });
  return NextResponse.json({ taskFlowMode: org?.taskFlowMode ?? "race" });
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }
  const organizationId = getActiveOrgId(session);
  const before = await db.organization.findUnique({
    where: { id: organizationId },
    select: { taskFlowMode: true },
  });
  await db.organization.update({
    where: { id: organizationId },
    data: { taskFlowMode: body.taskFlowMode },
  });
  if ((before?.taskFlowMode ?? "race") !== body.taskFlowMode) {
    await recordAuditLog({
      request,
      session,
      organizationId,
      action: "settings.task_flow_mode.update",
      entity: "organization",
      entityId: organizationId,
      details: {
        taskFlowMode: { from: before?.taskFlowMode ?? "race", to: body.taskFlowMode },
      },
    });
  }
  return NextResponse.json({ ok: true });
}
