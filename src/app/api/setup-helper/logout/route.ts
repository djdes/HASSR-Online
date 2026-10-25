import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readBearerToken } from "@/lib/print-agent-auth";
import { hashHelperToken } from "@/lib/setup-helper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/setup-helper/logout — «Выйти» в приложении: ключ этого
 * телефона перестаёт работать. Повторный вызов безвреден; если сети не
 * было, ключ можно отозвать на сайте кнопкой «Отключить».
 */
export async function POST(request: Request) {
  const raw = readBearerToken(request);
  if (!raw) return NextResponse.json({ error: "Нет ключа" }, { status: 401 });

  await db.setupHelperDevice.updateMany({
    where: { tokenHash: hashHelperToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
