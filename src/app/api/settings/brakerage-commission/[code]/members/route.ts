import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { isCommissionJournalCode } from "@/lib/brakerage-commission";
import { addOrgCommissionMember, ensureCommissionPosition } from "@/lib/brakerage-commission-org";
import { recordAuditLog } from "@/lib/audit-log";
import { generateEmployeeQrPin, setEmployeeQrPin } from "@/lib/qr-fill-actor";
import { validateQrPin } from "@/lib/qr-pin-rules";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";
import { createStaffMember } from "@/lib/staff-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  fullName: z.string().trim().min(2, "Введите ФИО").max(200),
  phone: z.string().trim().optional(),
  // PIN из формы (руководитель видит его до создания); нет — сгенерируем.
  pin: z.string().trim().optional(),
  // Роль в комиссии; нет — «Член комиссии».
  role: z.string().trim().max(80).optional(),
});

/**
 * «Новый человек» в окне «Сторонняя бракеражная комиссия»: сотрудник в
 * должности «Член бракеражной комиссии» (категория «Комиссия» на странице
 * сотрудников, доступ к бракеражу готовой продукции). ПИН показан в форме
 * до создания (можно поправить) — им член комиссии подписывает блюда по QR. Телефон по желанию; в TasksFlow не уходит.
 * Человек сразу попадает в утверждённый состав организации (и его копию в
 * активных документах) — «Сохранить состав» для этого не нужен.
 */
export async function POST(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Добавить члена комиссии может руководитель" }, { status: 403 });
  }
  const { code } = await ctx.params;
  if (!isCommissionJournalCode(code)) {
    return NextResponse.json({ error: "Сторонняя комиссия есть только у бракеража готовой продукции" }, { status: 400 });
  }
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте данные" }, { status: 400 });
  }
  const requestedPin = parsed.data.pin || "";
  if (requestedPin) {
    const pinProblem = validateQrPin(requestedPin);
    if (pinProblem) return NextResponse.json({ error: pinProblem }, { status: 400 });
  }
  const organizationId = getActiveOrgId(session);
  const position = await ensureCommissionPosition(organizationId);
  const created = await createStaffMember(organizationId, {
    jobPositionId: position.id,
    fullName: parsed.data.fullName,
    phone: parsed.data.phone || undefined,
  });
  if (!created.ok) {
    return NextResponse.json(
      { error: created.error, code: created.code, payUrl: created.payUrl },
      { status: created.status }
    );
  }
  const pin = requestedPin || generateEmployeeQrPin();
  const pinError = await setEmployeeQrPin(created.user.id, pin);
  const commission = await addOrgCommissionMember(organizationId, code, {
    employeeId: created.user.id,
    role: parsed.data.role || "Член комиссии",
  });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "staff.commission_member_create",
    entity: "User",
    entityId: created.user.id,
    details: { name: created.user.name, code },
  });
  return NextResponse.json({
    user: { id: created.user.id, name: created.user.name },
    pin: pinError ? null : pin,
    members: commission.members,
    updatedDocuments: commission.updatedDocuments,
  });
}
