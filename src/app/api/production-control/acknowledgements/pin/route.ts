import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";
import { visibleStaffWhere } from "@/lib/people-scope.server";
import { resolveQrFillActor } from "@/lib/qr-fill-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().min(1).max(64),
  pin: z.string().trim().regex(/^\d{4,6}$/),
});

/**
 * POST { userId, pin } — лист ознакомления с Программой (пункт 3.7 структуры
 * ППК): сотрудник на устройстве руководителя подтверждает «Ознакомлен и
 * согласен» своим PIN-кодом (тот же PIN, что для QR-форм: 5 ошибок — блок на
 * 15 минут). Руководитель отмечает только людей своей точки.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Введите PIN из 4–6 цифр" }, { status: 400 });
  const { userId, pin } = parsed.data;
  const { scope } = auth;

  const visible = await db.user.count({
    where: { AND: [{ id: userId, organizationId: scope.organizationId }, await visibleStaffWhere(auth.session)] },
  });
  if (visible === 0) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });

  const doc = await ackDocForUser(scope, userId, "ppk");
  if (!doc) return NextResponse.json({ error: "Программа не утверждена или сотрудник не из этого объекта" }, { status: 404 });

  const actor = await resolveQrFillActor({ mode: "pin", organizationId: scope.organizationId, employeeId: userId, pin });
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const mark = await db.ppkAcknowledgement.upsert({
    where: {
      organizationId_docKey_version_userId: { organizationId: scope.organizationId, docKey: doc.docKey, version: doc.version, userId },
    },
    create: { organizationId: scope.organizationId, docKey: doc.docKey, version: doc.version, userId },
    update: {},
    select: { acknowledgedAt: true },
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: scope.organizationId,
    action: "production-control.ack-pin",
    entity: "PpkAcknowledgement",
    entityId: userId,
    details: { docKey: doc.docKey, version: doc.version },
  });
  return NextResponse.json({ acknowledgedAt: mark.acknowledgedAt.toISOString() });
}
