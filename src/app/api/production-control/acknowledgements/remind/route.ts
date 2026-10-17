import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ackDocPath } from "@/lib/ppk/acknowledge";
import { ackDocument, ackStats } from "@/lib/ppk/acknowledge.server";
import { buildMiniAppUrl, getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { notifyEmployee } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ docKey: z.string().min(1).max(100) });

/**
 * POST { docKey } — напомнить в Telegram тем, кто ещё не ознакомился с текущей
 * версией документа. `sent` — сколько сотрудников с привязанным Telegram получили сообщение.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });

  const stats = await ackStats(auth.organizationId, parsed.data.docKey);
  if (!stats) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  const doc = await ackDocument(auth.organizationId, parsed.data.docKey);
  if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

  const linked = stats.pending.length
    ? await db.user.findMany({
        where: { id: { in: stats.pending.map((p) => p.userId) }, telegramChatId: { not: null } },
        select: { id: true },
      })
    : [];
  const miniAppUrl = buildMiniAppUrl(getMiniAppBaseUrlFromEnv(), ackDocPath(doc.docKey));
  const text = `Ознакомьтесь, пожалуйста: ${doc.title}`;
  for (const user of stats.pending) {
    await notifyEmployee(user.userId, text, miniAppUrl ? { label: "Открыть", miniAppUrl } : undefined);
  }
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.acknowledge-remind",
    entity: "PpkAcknowledgement",
    entityId: doc.docKey,
    details: { pending: stats.pending.length },
  });
  return NextResponse.json({ sent: linked.length });
}
