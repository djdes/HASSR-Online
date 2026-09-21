import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — ключи текущего сотрудника (для профиля). */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const rows = await db.webAuthnCredential.findMany({
    where: { userId: auth.session.user.id },
    select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ credentials: rows });
}

/** DELETE — удалить свой ключ. Body: { id } */
export async function DELETE(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id обязателен" }, { status: 400 });
  await db.webAuthnCredential.deleteMany({ where: { id: body.id, userId: auth.session.user.id } });
  return NextResponse.json({ ok: true });
}
