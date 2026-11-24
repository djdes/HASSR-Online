import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { ackDocForUser } from "@/lib/ppk/acknowledge.server";
import { ppkScopeForSession } from "@/lib/ppk/scope.server";
import { parseSignatureDataUrl } from "@/lib/ppk/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  docKey: z.string().min(1).max(100),
  /** Подпись пальцем (лист ознакомления с Программой, 2026-11-24): PNG data URL, необязательно. */
  signature: z.string().min(1).max(450_000).optional(),
});

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
  // Политика и положение о группе — ППК точки человека (2026-11-01).
  const doc = await ackDocForUser(await ppkScopeForSession(auth.session), userId, parsed.data.docKey);
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

  const signature = parsed.data.signature !== undefined ? parseSignatureDataUrl(parsed.data.signature) : null;
  if (signature && !signature.ok) return NextResponse.json({ error: signature.error }, { status: 400 });
  const mark = await db.ppkAcknowledgement.upsert({
    where: {
      organizationId_docKey_version_userId: { organizationId, docKey: doc.docKey, version: doc.version, userId },
    },
    create: {
      organizationId,
      docKey: doc.docKey,
      version: doc.version,
      userId,
      method: signature?.ok ? "finger" : "self",
      ...(signature?.ok ? { signature: signature.bytes } : {}),
    },
    update: {},
    select: { acknowledgedAt: true },
  });
  return NextResponse.json({ acknowledgedAt: mark.acknowledgedAt.toISOString() });
}
