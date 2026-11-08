import { NextResponse } from "next/server";
import { z } from "zod";

import { AccountManagerError, setAccountManager } from "@/lib/account-manager.server";
import { requireRoot } from "@/lib/auth-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ managerId: z.string().max(64).nullable() });

/**
 * PUT { managerId } — ответственный менеджер клиента. Закрепляет тот, кто
 * видит всех клиентов (РОП, директор, админ): правило `allScope` в
 * src/lib/platform-access.ts.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  try {
    const result = await setAccountManager(
      { id: session.user.id, name: session.user.name ?? null, organizationId: session.user.organizationId },
      id,
      parsed.data.managerId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AccountManagerError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
