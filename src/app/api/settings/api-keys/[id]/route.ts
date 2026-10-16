import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { revokeApiKey } from "@/lib/public-api/key-admin";
import { keyAdminGuard } from "@/lib/public-api/key-admin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Отзыв ключа: перестаёт работать со следующего запроса. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const guard = keyAdminGuard(auth.session);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await params;
  const result = await revokeApiKey({ orgId: guard.orgId, keyId: id, actor: guard.user });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
