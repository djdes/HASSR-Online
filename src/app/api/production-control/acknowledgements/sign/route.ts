import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";
import { parseSignatureDataUrl } from "@/lib/ppk/signature";
import { visibleStaffWhere } from "@/lib/people-scope.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().min(1).max(64),
  signature: z.string().min(1).max(450_000),
});

/**
 * POST { userId, signature } — лист ознакомления с Программой (пункт 3.7):
 * сотрудник на устройстве руководителя ставит «Ознакомлен и согласен»
 * подписью пальцем по экрану (документ владельца: «возможно сделать подпись
 * пальцем»). Подпись — PNG до 300 КБ; руководитель отмечает только людей своей
 * точки. Отметка без подписи (в кабинете) получает подпись, остальное не меняется.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  const signature = parseSignatureDataUrl(parsed.data.signature);
  if (!signature.ok) return NextResponse.json({ error: signature.error }, { status: 400 });
  const { userId } = parsed.data;
  const { scope } = auth;

  const visible = await db.user.count({
    where: { AND: [{ id: userId, organizationId: scope.organizationId }, await visibleStaffWhere(auth.session)] },
  });
  if (visible === 0) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });

  const doc = await ackDocForUser(scope, userId, "ppk");
  if (!doc) return NextResponse.json({ error: "Программа не утверждена или сотрудник не из этого объекта" }, { status: 404 });

  const where = {
    organizationId_docKey_version_userId: { organizationId: scope.organizationId, docKey: doc.docKey, version: doc.version, userId },
  };
  const existing = await db.ppkAcknowledgement.findUnique({ where, select: { id: true, signature: true } });
  const data = { method: "finger", signature: signature.bytes, collectedById: auth.session.user.id };
  const mark = existing
    ? existing.signature
      ? await db.ppkAcknowledgement.findUniqueOrThrow({ where, select: { acknowledgedAt: true } })
      : await db.ppkAcknowledgement.update({ where, data, select: { acknowledgedAt: true } })
    : await db.ppkAcknowledgement.create({
        data: { organizationId: scope.organizationId, docKey: doc.docKey, version: doc.version, userId, ...data },
        select: { acknowledgedAt: true },
      });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: scope.organizationId,
    action: "production-control.ack-finger",
    entity: "PpkAcknowledgement",
    entityId: userId,
    details: { docKey: doc.docKey, version: doc.version, bytes: signature.bytes.length },
  });
  return NextResponse.json({ acknowledgedAt: mark.acknowledgedAt.toISOString() });
}
