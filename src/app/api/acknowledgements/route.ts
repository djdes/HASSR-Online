import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ docKey: z.string().min(1).max(100) });

/**
 * POST — сотрудник отмечает, что ознакомился с текущей версией документа.
 * Повторная отметка той же версии ничего не меняет (отдаётся прежняя дата).
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });

  const organizationId = getActiveOrgId(auth.session);
  const userId = auth.session.user.id;
  const doc = await ackDocForUser(organizationId, userId, parsed.data.docKey);
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

  const mark = await db.ppkAcknowledgement.upsert({
    where: {
      organizationId_docKey_version_userId: { organizationId, docKey: doc.docKey, version: doc.version, userId },
    },
    create: { organizationId, docKey: doc.docKey, version: doc.version, userId },
    update: {},
    select: { acknowledgedAt: true },
  });
  return NextResponse.json({ acknowledgedAt: mark.acknowledgedAt.toISOString() });
}
