import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";
import { checkPpkRefs, checkPpkTeamGroup, ppkValidationError } from "@/lib/ppk/records.server";
import { PPK_RECORD_SCHEMAS, isPpkRecordBlock } from "@/lib/ppk/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = { id: true, data: true, sortOrder: true, updatedAt: true } as const;

/** PATCH { data?, sortOrder? } — правка записи ППК своей точки (или организации). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await db.ppkRecord.findFirst({
    where: { id, ...ppkWhere(auth.scope) },
    select: { id: true, block: true, data: true },
  });
  if (!existing || !isPpkRecordBlock(existing.block)) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const hasData = body?.data !== undefined;
  const hasOrder = Number.isInteger(body?.sortOrder);
  if (!hasData && !hasOrder) {
    return NextResponse.json({ error: "Нечего сохранять" }, { status: 400 });
  }

  const update: { data?: Prisma.InputJsonValue; sortOrder?: number } = {};
  if (hasData) {
    const parsed = PPK_RECORD_SCHEMAS[existing.block].safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json({ error: ppkValidationError(parsed.error) }, { status: 400 });
    }
    // Схема блока уже проверила данные; тип в реестре общий, поэтому приводим здесь.
    const value = parsed.data as Record<string, unknown>;
    const refError = await checkPpkRefs(auth.scope, existing.block, value);
    if (refError) return NextResponse.json({ error: refError }, { status: 400 });
    if (existing.block === "team") {
      const groupError = await checkPpkTeamGroup(auth.scope, value, id);
      if (groupError) return NextResponse.json({ error: groupError }, { status: 409 });
    }
    // Токен политики не меняется при правке текста: его меняет только «Сменить ссылку».
    const token = (existing.data as { token?: unknown } | null)?.token;
    const next = existing.block === "policy" && typeof token === "string" ? { ...value, token } : value;
    update.data = next as Prisma.InputJsonValue;
  }
  if (hasOrder) update.sortOrder = body.sortOrder;

  const record = await db.ppkRecord.update({ where: { id }, data: update, select: SELECT });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.record-update",
    entity: "PpkRecord",
    entityId: id,
    details: { block: existing.block, data: hasData, sortOrder: hasOrder },
  });
  return NextResponse.json({ record });
}

/** DELETE — удалить запись ППК своей точки (или организации). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const existing = await db.ppkRecord.findFirst({
    where: { id, ...ppkWhere(auth.scope) },
    select: { id: true, block: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }
  if (existing.block === "hazards") {
    // Точки, ссылавшиеся на удалённую опасность, остаются без ссылки: иначе их потом не сохранить.
    await db.$transaction(async (tx) => {
      const points = await tx.ppkRecord.findMany({
        where: { ...ppkWhere(auth.scope), block: "control-points" },
        select: { id: true, data: true },
      });
      for (const point of points) {
        const data = point.data as { hazardId?: unknown } | null;
        if (data?.hazardId === id) {
          await tx.ppkRecord.update({
            where: { id: point.id },
            data: { data: { ...data, hazardId: null } as Prisma.InputJsonValue },
          });
        }
      }
      await tx.ppkRecord.delete({ where: { id } });
    });
  } else {
    await db.ppkRecord.delete({ where: { id } });
  }
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.record-delete",
    entity: "PpkRecord",
    entityId: id,
    details: { block: existing.block },
  });
  return NextResponse.json({ ok: true });
}
