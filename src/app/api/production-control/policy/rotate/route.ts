import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — выпустить новый токен политики. Старый QR перестаёт открывать текст:
 * публичная страница ищет запись именно по токену.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const policy = await db.ppkRecord.findFirst({
    where: { ...ppkWhere(auth.scope), block: "policy" },
    select: { id: true, data: true },
  });
  if (!policy) {
    return NextResponse.json({ error: "Сначала заполните политику" }, { status: 404 });
  }
  const token = randomBytes(16).toString("base64url");
  await db.ppkRecord.update({
    where: { id: policy.id },
    data: { data: { ...(policy.data as object), token } as Prisma.InputJsonValue },
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.policy-rotate",
    entity: "PpkRecord",
    entityId: policy.id,
    details: {},
  });
  return NextResponse.json({ token });
}
