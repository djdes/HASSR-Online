import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { IDEA_ADMIN_NOTE_MAX, IDEA_STATUS_LABEL, describeIdeaStatusChange, isIdeaStatus } from "@/lib/ideas/rules";
import { upsertNotification } from "@/lib/notifications";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import { shortIdeaTitle } from "@/i18n/notification-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { status?, adminNote? } — статус и комментарий ROOT; автору уходит уведомление в кабинет. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown; adminNote?: unknown };
  const data: { status?: string; statusChangedAt?: Date; adminNote?: string | null } = {};
  if (body.status !== undefined) {
    if (!isIdeaStatus(body.status)) return NextResponse.json({ error: "Неизвестный статус" }, { status: 400 });
    data.status = body.status;
  }
  if (body.adminNote !== undefined) {
    if (body.adminNote !== null && typeof body.adminNote !== "string") {
      return NextResponse.json({ error: "Некорректный комментарий" }, { status: 400 });
    }
    const note = typeof body.adminNote === "string" ? body.adminNote.trim().slice(0, IDEA_ADMIN_NOTE_MAX) : "";
    data.adminNote = note ? note : null;
  }
  if (!("status" in data) && !("adminNote" in data)) {
    return NextResponse.json({ error: "Нечего менять" }, { status: 400 });
  }
  const before = await db.idea.findUnique({ where: { id }, select: { id: true, title: true, status: true, organizationId: true, authorId: true } });
  if (!before) return NextResponse.json({ error: "Идея не найдена" }, { status: 404 });
  if (data.status && data.status !== before.status) data.statusChangedAt = new Date();

  const idea = await db.idea.update({
    where: { id },
    data,
    select: { id: true, status: true, adminNote: true, statusChangedAt: true },
  });

  if (data.status && data.status !== before.status && isIdeaStatus(data.status)) {
    emitWebhook(before.organizationId, "idea.status", { ideaId: before.id, title: before.title, status: data.status, adminNote: data.adminNote ?? null });
    await upsertNotification({
      organizationId: before.organizationId,
      userId: before.authorId,
      kind: "idea.status",
      dedupeKey: `idea:${before.id}:${data.status}`,
      title: describeIdeaStatusChange(before.title, data.status),
      messageKey: "ideaStatus",
      messageParams: { title: shortIdeaTitle(before.title), status: data.status },
      linkHref: "/ideas",
      linkLabel: "Открыть идеи",
      linkLabelKey: "openIdeas",
      items: [{ id: before.id, label: before.title, hint: IDEA_STATUS_LABEL[data.status], hintKey: "ideaStatusLabel", hintParams: { status: data.status } }],
    }).catch((error) => console.error("[ideas] notify author failed", error));
  }
  await recordAuditLog({
    organizationId: before.organizationId,
    session,
    request,
    action: "idea.update",
    entity: "Idea",
    entityId: id,
    details: { status: data.status ?? null, adminNote: data.adminNote ?? null },
  });
  return NextResponse.json({ idea: { ...idea, statusChangedAt: idea.statusChangedAt?.toISOString() ?? null } });
}

/** DELETE — убрать идею совсем (спам, дубль, тестовая запись). Голоса уходят каскадом. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const idea = await db.idea.findUnique({ where: { id }, select: { id: true, title: true, organizationId: true } });
  if (!idea) return NextResponse.json({ error: "Идея не найдена" }, { status: 404 });
  await db.idea.delete({ where: { id } });
  await recordAuditLog({
    organizationId: idea.organizationId,
    session,
    request,
    action: "idea.delete",
    entity: "Idea",
    entityId: id,
    details: { title: idea.title },
  });
  return NextResponse.json({ ok: true });
}
