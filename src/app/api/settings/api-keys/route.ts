import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { createApiKey, createApiKeySchema, listOrgApiKeys } from "@/lib/public-api/key-admin";
import { keyAdminGuard } from "@/lib/public-api/key-admin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Список персональных ключей организации — без секретов. */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const guard = keyAdminGuard(auth.session);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  return NextResponse.json({ keys: await listOrgApiKeys(guard.orgId, guard.user.id) });
}

/** Выпуск ключа: полный ключ — только в этом ответе. */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const guard = keyAdminGuard(auth.session);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const parsed = createApiKeySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Укажите название ключа (до 60 символов)" }, { status: 400 });
  }
  const result = await createApiKey({ orgId: guard.orgId, user: guard.user, ...parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { key: result.key, secret: result.secret, mcpUrl: result.mcpUrl },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
